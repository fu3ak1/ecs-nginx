
interface IParam {
    readonly pjPrefix: string;
    readonly region: string;
    readonly cidr: string;
    readonly taskMin: number;
    readonly taskMax: number;
}

export const dev: IParam = {
    pjPrefix: 'dev',
    region: 'ap-northeast-1',
    cidr: '10.0.0.0/16',
    taskMin: 2,
    taskMax: 10,
}

// -- SAMPLE: Add more Stacks
/*
export const stg: IParam = {
    pjPrefix: 'stg',
    region: 'ap-northeast-1',
    cidr: '10.10.0.0/16',
    taskMin: 2,
    taskMax: 10,
}
*/