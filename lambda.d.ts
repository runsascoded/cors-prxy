interface LambdaEvent {
    requestContext: {
        http: {
            method: string;
            path: string;
            sourceIp: string;
        };
    };
    rawQueryString: string;
    headers: Record<string, string>;
}
interface LambdaResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    isBase64Encoded: boolean;
}
export declare function handler(event: LambdaEvent): Promise<LambdaResponse>;
export {};
