import { DescribeUserCommand, DirectoryServiceDataClient, DirectoryServiceDataServiceException, ListGroupsForMemberCommand, ListUsersCommand } from '@aws-sdk/client-directory-service-data';
import { Context, Handler } from 'aws-lambda';
import { BedrockAgentEvent, BedrockAgentResponse } from './bedrock-agent-event';

export const handler: Handler = async (event: BedrockAgentEvent, _context: Context): Promise<BedrockAgentResponse> => {
  const client = new DirectoryServiceDataClient();

  let body = null;

  try {
    switch (event.function) {
      case "AD-GetAllUsers":
        {
          const command = new ListUsersCommand({ DirectoryId: process.env.DIRECTORY_ID });
          const response = await client.send(command);
          body = JSON.stringify(response.Users);
          break;
        }
      case "AD-GetUserDetails":
        {
          const command = new DescribeUserCommand({
            DirectoryId: process.env.DIRECTORY_ID,
            SAMAccountName: event.parameters?.find(p => p.name == "username")?.value
          });
          const response = await client.send(command);
          body = JSON.stringify(response);
          break;
        }
      case "AD-GetUserGroups":
        {
          const command = new ListGroupsForMemberCommand({
            DirectoryId: process.env.DIRECTORY_ID,
            SAMAccountName: event.parameters?.find(p => p.name == "username")?.value
          });
          const response = await client.send(command);
          body = JSON.stringify(response.Groups);
          break;
        }
    }
  }
  catch (e) {
    if (e instanceof DirectoryServiceDataServiceException) {
      body = e.message;
    }
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