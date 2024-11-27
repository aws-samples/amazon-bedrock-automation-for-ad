import {
  Stack,
  StackProps,
  aws_ec2 as ec2
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export class VpcStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "VPC", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/20"),
      vpcName: "AutomateADBedrockVPC",
      maxAzs: 2,
      createInternetGateway: false,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      flowLogs: {
        "AutomateADBedrockVPCFlowLog": {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL
        },
      },
    });

    const addInterfaceEndpoint = (id: string, service: ec2.InterfaceVpcEndpointAwsService) => {
      this.vpc.addInterfaceEndpoint(id, {
        privateDnsEnabled: true,
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      });

      NagSuppressions.addResourceSuppressionsByPath(this, `/${this.node.id}/${this.vpc.node.id}/${id}/SecurityGroup`,
        [
          {
            id: "CdkNagValidationFailure",
            reason: "CdkNagValidationFailure when adding interface endpoints - https://github.com/cdklabs/cdk-nag/issues/817"
          }
        ]
      );
    }

    addInterfaceEndpoint("ssm-messages", ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES);
    addInterfaceEndpoint("ssm", ec2.InterfaceVpcEndpointAwsService.SSM);
    addInterfaceEndpoint("ec2messages", ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES);
    addInterfaceEndpoint("ds", ec2.InterfaceVpcEndpointAwsService.DIRECTORY_SERVICE);
  }
}