import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cwl from 'aws-cdk-lib/aws-logs';

export class EcsNginxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const region = new cdk.ScopedAws(this).region

    const vpc = new ec2.Vpc(this, 'Vpc', {
      natGateways: 1,
      // In Tokyo region, b will be an error.
      availabilityZones: [`${region}a`,`${region}c`,`${region}d`]
    });

    const securityGroupForAlb = new ec2.SecurityGroup(this, 'SgAlb', {
      vpc: vpc,
      allowAllOutbound: true,
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: vpc,
      internetFacing: true,
      securityGroup: securityGroupForAlb,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
    });

    const lbForAppListener = alb.addListener('http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true,
    });

    const ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: vpc,
      //containerInsights: true,
    });

    const executionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });

    const securityGroupForFargate = new ec2.SecurityGroup(this, 'SgFargate', {
      vpc: vpc,
      allowAllOutbound: true, // for AWS APIs
    });

    const fargateLogGroup = new cwl.LogGroup(this, 'FargateLogGroup', {
      retention: cwl.RetentionDays.ONE_YEAR,
    });

    const ecsTask = new ecs.FargateTaskDefinition(this, 'EcsTask', {
      executionRole: executionRole,
      cpu: 256,
      memoryLimitMiB: 512,
    });

    const container = ecsTask.addContainer('nginx', {
      image: ecs.ContainerImage.fromRegistry("public.ecr.aws/nginx/nginx:1.24"),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'ECS-',
        logGroup: fargateLogGroup,
      })
    });

    container.addPortMappings({
      containerPort: 80,
    })

    // Service
    const ecsService = new ecs.FargateService(this, 'FargateService', {
      cluster: ecsCluster,
      taskDefinition: ecsTask,
      desiredCount: 2,

      // https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-readme.html#fargate-capacity-providers
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
        // -- SAMPLE: Fargate Spot
        //{
        //  capacityProvider: 'FARGATE_SPOT',
        //  weight: 2,
        //},
      ],
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }),
      securityGroups: [securityGroupForFargate],
    });

    lbForAppListener.addTargets('nginx', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [ecsService],
    });

  }
}
