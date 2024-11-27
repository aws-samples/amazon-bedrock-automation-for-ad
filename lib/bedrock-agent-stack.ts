import {
  Duration,
  Stack,
  StackProps,
  aws_bedrock as bedrock,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambda_nodejs
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface BedrockAgentStackProps extends StackProps {
  adManagementInstanceId: string;
  directoryId: string;
  documentNames: string[];
}

export class BedrockAgentStack extends Stack {
  constructor(scope: Construct, id: string, props: BedrockAgentStackProps) {
    super(scope, id, props);
    const executeADQueryFunction = new lambda_nodejs.NodejsFunction(this, "ExecuteADQuery", {
      entry: "./lambda/execute-ad-query.ts",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        AD_MANAGEMENT_INSTANCE_ID: props.adManagementInstanceId
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            "ssm:SendCommand"
          ],
          resources: [
            this.formatArn({
              service: "ec2",
              resource: "instance",
              resourceName: props.adManagementInstanceId
            }),
            ...props.documentNames.map(name => this.formatArn({
              service: "ssm",
              resource: "document",
              resourceName: name
            }))
          ],
        }),
        new iam.PolicyStatement({
          actions: [
            "ssm:GetCommandInvocation"
          ],
          resources: ["*"]
        })
      ],
    });

    NagSuppressions.addResourceSuppressions(
      executeADQueryFunction,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "ssm:GetCommandInvocation requires wildcard resource - https://docs.aws.amazon.com/service-authorization/latest/reference/list_awssystemsmanager.html"
        }
      ],
      true
    );

    const executeManagedADDataQueryFunction = new lambda_nodejs.NodejsFunction(this, "ExecuteManagedADDataQuery", {
      entry: "./lambda/execute-managed-ad-data-query.ts",
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        bundleAwsSDK: true // client-directory-service-data not available in the Lambda provided SDK
      },
      timeout: Duration.seconds(15),
      environment: {
        DIRECTORY_ID: props.directoryId
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: [
            "ds-data:DescribeUser",
            "ds-data:ListGroupsForMember",
            "ds-data:ListUsers",
            "ds:AccessDSData"
          ],
          resources: ["*"],
        })
      ]
    });

    NagSuppressions.addResourceSuppressions(
      executeManagedADDataQueryFunction,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "AWS Directory Service and Directory Service Data only support wildcard resources in IAM policies - https://docs.aws.amazon.com/directoryservice/latest/admin-guide/UsingWithDS_IAM_ResourcePermissions.html"
        }
      ],
      true
    );

    const agentFoundationModel = bedrock.FoundationModel.fromFoundationModelId(this, "AgentModel",
      bedrock.FoundationModelIdentifier.ANTHROPIC_CLAUDE_3_SONNET_20240229_V1_0);

    const agentRole = new iam.Role(this, "AgentRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      inlinePolicies: {
        "BedrockAgentPolicy": new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                "bedrock:InvokeModel"
              ],
              resources: [agentFoundationModel.modelArn]
            })
          ]
        })
      }
    });

    const agent = new bedrock.CfnAgent(this, "ADAgent", {
      agentName: "ADAgent",
      description: "Agent to assist with Active Directory administration and troubleshooting",
      foundationModel: agentFoundationModel.modelId,
      agentResourceRoleArn: agentRole.roleArn,
      autoPrepare: true,
      instruction: `You are an experienced Windows Systems Administrator. When you are given a task to perform, follow the instructions in the most appropriate runbook to complete it. Follow the rules and policies contained within our knowledge bases.

      When you are being asked to check usergroup, give the common name only, not the full group name.
      
      If you are asked to perform an action which you can not do because there are no action groups and functions which give you access, just state that it is something that you can't do and don't ask clarifying questions.
      
      If there is missing information needed for an action you can do, then ask a clarifying question.`,
      actionGroups: [{
        actionGroupName: "ExecuteADQuery",
        description: "Queries Active Directory via SSM Run Command Documents",
        actionGroupExecutor: {
          lambda: executeADQueryFunction.functionArn
        },
        functionSchema: {
          functions: [{
            name: "AD-GetAllUsers",
            description: "Get all users in Active Directory"
          }, {
            name: "AD-GetUserDetails",
            description: "Get details of a specific user in Active Directory",
            parameters: {
              username: {
                type: "string",
                description: "The username of the user to retrieve",
                required: true
              }
            }
          }]
        }
      }, {
        actionGroupName: "ExecuteManagedADDataQuery",
        description: "Queries Active Directory via AWS Directory Service Data API",
        actionGroupExecutor: {
          lambda: executeManagedADDataQueryFunction.functionArn
        },
        functionSchema: {
          functions: [{
            name: "AD-GetAllUsers",
            description: "List all users in Active Directory"
          }, {
            name: "AD-GetUserDetails",
            description: "Get details of a specific user in Active Directory",
            parameters: {
              username: {
                type: "string",
                description: "The username of the user to retrieve",
                required: true
              }
            }
          }, {
            name: "AD-GetUserGroups",
            description: "List all groups for a specific user in Active Directory",
            parameters: {
              username: {
                type: "string",
                description: "The username of the user to retrieve groups of",
                required: true
              }
            }
          }]
        }
      }]
    });

    const agentPrincipal = new iam.ServicePrincipal("bedrock.amazonaws.com", {
      conditions: {
        StringEquals: {
          "aws:SourceAccount": Stack.of(this).account,
        },
        ArnLike: {
          "aws:SourceArn": agent.attrAgentArn
        }
      }
    })

    executeADQueryFunction.grantInvoke(agentPrincipal);
    executeManagedADDataQueryFunction.grantInvoke(agentPrincipal);

    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "Allow AWSLambdaBasicExecutionRole managed policy",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ]
        }
      ]
    );
  }
}
