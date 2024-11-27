import {
  CommandInvocationStatus,
  GetCommandInvocationCommand,
  SSMClient,
  SendCommandCommand,
  waitUntilCommandExecuted
} from '@aws-sdk/client-ssm';
import { Context, Handler } from 'aws-lambda';
import { BedrockAgentEvent, BedrockAgentResponse } from './bedrock-agent-event';

export const handler: Handler = async (event: BedrockAgentEvent, _context: Context): Promise<BedrockAgentResponse> => {
  const client = new SSMClient();
  const input = {
    InstanceIds: [process.env.AD_MANAGEMENT_INSTANCE_ID ?? ""],
    DocumentName: event.function,
    Parameters: (event.parameters ? Object.fromEntries(event.parameters.map(p => [p.name, [p.value]])) : undefined)
  };

  let body;

  try {
    const sendCommandResponse = await client.send(new SendCommandCommand(input));

    const getCommandInput = {
      CommandId: sendCommandResponse.Command?.CommandId,
      InstanceId: sendCommandResponse.Command?.InstanceIds?.[0]
    };

    await waitUntilCommandExecuted({ client, maxWaitTime: 10 }, getCommandInput);

    const commandResponse = await client.send(new GetCommandInvocationCommand(getCommandInput));

    body = commandResponse.Status == CommandInvocationStatus.SUCCESS ?
      commandResponse.StandardOutputContent : commandResponse.StandardErrorContent;
  }
  catch (error) {
    console.error(error);
  }

  return {
    messageVersion: event.messageVersion,
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: {
        responseBody: {
          "TEXT": {
            body: body ?? "There was an error"
          }
        }
      }
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes
  };
};