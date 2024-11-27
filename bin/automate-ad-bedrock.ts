#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import 'source-map-support/register';
import { BedrockAgentStack } from '../lib/bedrock-agent-stack';
import { ManagedAdStack } from '../lib/managed-ad-stack';
import { VpcStack } from '../lib/vpc-stack';

const app = new cdk.App();

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const vpcStack = new VpcStack(app, 'VpcStack');
const managedAdStack = new ManagedAdStack(app, 'ManagedAdStack', { vpc: vpcStack.vpc });
new BedrockAgentStack(app, 'BedrockAgentStack', {
  adManagementInstanceId: managedAdStack.managementInstanceId,
  directoryId: managedAdStack.directoryId,
  documentNames: managedAdStack.documentNames
});