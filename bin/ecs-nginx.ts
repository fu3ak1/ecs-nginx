#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsNginxStack } from '../lib/ecs-nginx-stack';

const app = new cdk.App();
new EcsNginxStack(app, 'EcsNginxStack', {
  //https://docs.aws.amazon.com/cdk/latest/guide/environments.html 
  env: { region: 'ap-northeast-1' },
});