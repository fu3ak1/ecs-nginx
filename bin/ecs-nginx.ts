#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsNginxStack } from '../lib/ecs-nginx-stack';
import * as param from '../param/parameter'

const app = new cdk.App();
new EcsNginxStack(app, `${param.dev.pjPrefix}-EcsNginxStack`, {
  //https://docs.aws.amazon.com/cdk/latest/guide/environments.html 
  env: { region: param.dev.region },
  cidr: param.dev.cidr,
  taskMin: param.dev.taskMin,
  taskMax: param.dev.taskMax,
});

// -- SAMPLE: Add more Stacks
/*
new EcsNginxStack(app, `${param.stg.pjPrefix}-EcsNginxStack`, {
  //https://docs.aws.amazon.com/cdk/latest/guide/environments.html 
  env: { region: param.stg.region },
  cidr: param.stg.cidr,
  taskMin: param.stg.taskMin,
  taskMax: param.stg.taskMax,
});
*/