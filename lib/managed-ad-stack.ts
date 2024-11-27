import {
  CfnOutput,
  Stack,
  StackProps,
  custom_resources as cr,
  aws_directoryservice as directoryservice,
  aws_ec2 as ec2,
  aws_iam as iam,
  aws_secretsmanager as secretsmanager,
  aws_ssm as ssm
} from "aws-cdk-lib";
import { AwsCustomResource } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface ManagedAdStackProps extends StackProps {
  vpc: ec2.Vpc;
}

export class ManagedAdStack extends Stack {
  public readonly managementInstanceId: string;
  public readonly directoryId: string;
  public readonly documentNames: string[]

  constructor(scope: Construct, id: string, props: ManagedAdStackProps) {
    super(scope, id, props);

    const adminPassword = new secretsmanager.Secret(this, "ManagedADPassword");

    NagSuppressions.addResourceSuppressions(
      adminPassword,
      [
        {
          id: "AwsSolutions-SMG4",
          reason: "Ephemeral demo environment does not require secrets rotation"
        }
      ]
    )

    const directory = new directoryservice.CfnMicrosoftAD(this, "ManagedAD", {
      name: "ad-bedrock-demo.example.com",
      password: adminPassword.secretValue.unsafeUnwrap(), // managed AD password is write only
      edition: "Standard",
      shortName: "AD-BEDROCK-DEMO",
      vpcSettings: {
        subnetIds: props.vpc.isolatedSubnets.map(subnet => subnet.subnetId),
        vpcId: props.vpc.vpcId
      }
    });

    // Enable Directory Service Data API
    const enableDirectoryDataAccess = new cr.AwsCustomResource(this, "EnableDirectoryDataAccess", {
      functionName: "CustomResourceFunction",
      installLatestAwsSdk: true,
      onCreate: {
        service: "directory-service",
        action: "EnableDirectoryDataAccess",
        parameters: {
          DirectoryId: directory.ref
        },
        physicalResourceId: cr.PhysicalResourceId.of("EnableDirectoryDataAccess")
      },
      onDelete: {
        service: "directory-service",
        action: "DisableDirectoryDataAccess",
        parameters: {
          DirectoryId: directory.ref
        }
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [
          this.formatArn({
            service: "ds",
            resource: "directory",
            resourceName: directory.ref
          })
        ]
      })
    });

    NagSuppressions.addResourceSuppressionsByPath(this,
      `/${this.node.id}/AWS${AwsCustomResource.PROVIDER_FUNCTION_UUID.replace(/-/g, "")}`,
      [
        {
          id: "CdkNagValidationFailure",
          reason: "Resolving latest Lambda runtime for the custom resource uses an intrinsic function"
        }
      ]
    );

    this.directoryId = directory.ref;

    const managementInstance = new ec2.Instance(this, "ADManagementInstance", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestWindows(ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(30, { encrypted: true })
        }
      ],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      userData: ec2.UserData.forWindows()
    });
    managementInstance.userData.addCommands(
      "Install-WindowsFeature -Name GPMC,RSAT-AD-PowerShell,RSAT-AD-AdminCenter,RSAT-ADDS-Tools,RSAT-DNS-Server"
    );
    managementInstance.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    managementInstance.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMDirectoryServiceAccess"));

    this.managementInstanceId = managementInstance.instanceId;

    NagSuppressions.addResourceSuppressions(
      managementInstance,
      [
        {
          id: "AwsSolutions-EC28",
          reason: "Ephemeral demo environment does not require detailed monitoring"
        },
        {
          id: "AwsSolutions-EC29",
          reason: "Ephemeral demo environment does not require termination protection"
        }
      ]
    );

    NagSuppressions.addResourceSuppressions(
      managementInstance.role,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "AWS Directory Service only supports wildcard resources in IAM policies - https://docs.aws.amazon.com/directoryservice/latest/admin-guide/UsingWithDS_IAM_ResourcePermissions.html#actions-related-to-objects-table"
        }
      ]
    )

    const domainJoinAssociation = new ssm.CfnAssociation(this, "DomainJoinAssociation", {
      associationName: "ADBedockDemoDomainJoin",
      name: "AWS-JoinDirectoryServiceDomain",
      targets: [{ key: "instanceIds", values: [managementInstance.instanceId] }],
      parameters: {
        directoryId: [directory.ref],
        directoryName: [directory.name],
        dnsIpAddresses: directory.attrDnsIpAddresses
      }
    });

    const getAllUsersDocument = new ssm.CfnDocument(this, "GetAllUsersDocument", {
      documentType: "Command",
      name: "AD-GetAllUsers",
      targetType: "/AWS::EC2::Instance",
      content: {
        schemaVersion: "2.2",
        description: "Run a PowerShell script to get all users from AD",
        mainSteps: [
          {
            name: "runPowerShellScript",
            action: "aws:runPowerShellScript",
            inputs: {
              runCommand: [
                "Get-ADUser -Filter * | Format-Table SamAccountName -A"
              ]
            }
          }
        ]
      }
    });

    const getUserDetailsDocument = new ssm.CfnDocument(this, "GetUserDetailsDocument", {
      documentType: "Command",
      name: "AD-GetUserDetails",
      targetType: "/AWS::EC2::Instance",
      content: {
        schemaVersion: "2.2",
        description: "Run a PowerShell script to get details of one user from AD",
        parameters: {
          username: {
            type: "String",
            description: "The username of the user to retrieve"
          }
        },
        mainSteps: [
          {
            name: "runPowerShellScript",
            action: "aws:runPowerShellScript",
            inputs: {
              runCommand: [
                "Get-ADUser -Identity {{ username }} -Properties *"
              ]
            }
          }
        ]
      }
    });

    this.documentNames = [
      getAllUsersDocument.ref,
      getUserDetailsDocument.ref
    ]

    new CfnOutput(this, "ADManagementInstanceId", { value: this.managementInstanceId });

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
