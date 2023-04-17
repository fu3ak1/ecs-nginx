import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cwl from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2'
import * as ri from 'aws-cdk-lib/region-info';

export interface EcsNginxStackProps extends cdk.StackProps{
  cidr: string;
  taskMin: number;
  taskMax: number;
}

export class EcsNginxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsNginxStackProps) {
    super(scope, id, props);

    // -- VPC --
    const vpc = new ec2.Vpc(this, 'Vpc', {
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr(props.cidr),
      // In Tokyo region, b will be an error.
      availabilityZones: [`${cdk.Stack.of(this).region}a`,`${cdk.Stack.of(this).region}c`,`${cdk.Stack.of(this).region}d`]
    });

    // enabling flow log for VPC
    const flowLogBucket = new s3.Bucket(this, 'FlowLogBucket', {
      accessControl: s3.BucketAccessControl.PRIVATE,
      encryption: s3.BucketEncryption.KMS,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    vpc.addFlowLog('FlowLogs', {
      destination: ec2.FlowLogDestination.toS3(flowLogBucket),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    
    // -- ALB --
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

    // enableing access log for ALB
    const albLogBucket = new s3.Bucket(this, 'AlbLogBucket', {
      accessControl: s3.BucketAccessControl.PRIVATE,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      enforceSSL: true,
    });

    alb.setAttribute('access_logs.s3.enabled', 'true');
    alb.setAttribute('access_logs.s3.bucket', albLogBucket.bucketName);

    //https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html#attach-bucket-policy
    albLogBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        principals: [new iam.AccountPrincipal(ri.RegionInfo.get(cdk.Stack.of(this).region).elbv2Account)],
        resources: [albLogBucket.arnForObjects(`AWSLogs/${cdk.Stack.of(this).account}/*`)],
      }),
    );

    // -- AWS WAF for ALB --
    const webAcl = new wafv2.CfnWebACL(this, `${cdk.Stack.of(this).stackName}-WebAcl`, {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'WebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          priority: 1,
          overrideAction: { count: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesCommonRuleSet',
          },
          name: 'AWSManagedRulesCommonRuleSet',
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
        {
          priority: 2,
          overrideAction: { count: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          },
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        },
        {
          priority: 3,
          overrideAction: { count: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
          },
          name: 'AWSManagedRulesAmazonIpReputationList',
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
        },
        {
          priority: 4,
          overrideAction: { count: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWS-AWSManagedRulesLinuxRuleSet',
          },
          name: 'AWSManagedRulesLinuxRuleSet',
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesLinuxRuleSet',
            },
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    
    // -- ECS --
    const ecsCluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: vpc,
      // -- SAMPLE: Container Insights
      //https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-container-insights.html
      //containerInsights: true,
    });

    const executionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });

    const securityGroupForFargate = new ec2.SecurityGroup(this, 'SgFargate', {
      vpc: vpc,
      allowAllOutbound: true,
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

    // ECS Task AutoScaling
    // https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-readme.html#task-auto-scaling
    const ecsScaling = ecsService.autoScaleTaskCount({
      minCapacity: props.taskMin,
      maxCapacity: props.taskMax,
    });

    ecsScaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
    });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });

  }
}
