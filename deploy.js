import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand, GetFunctionUrlConfigCommand, CreateFunctionUrlConfigCommand, AddPermissionCommand, TagResourceCommand, waitUntilFunctionActive, waitUntilFunctionUpdated, } from "@aws-sdk/client-lambda";
import { IAMClient, CreateRoleCommand, GetRoleCommand, PutRolePolicyCommand, } from "@aws-sdk/client-iam";
import { buildTags } from "./tags.js";
const LAMBDA_TRUST_POLICY = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
});
const LOGS_POLICY = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
            Effect: "Allow",
            Action: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
            ],
            Resource: "arn:aws:logs:*:*:*",
        }],
});
async function ensureRole(iam, roleName, tags) {
    try {
        const resp = await iam.send(new GetRoleCommand({ RoleName: roleName }));
        return resp.Role.Arn;
    }
    catch (err) {
        if (err.name !== "NoSuchEntityException")
            throw err;
    }
    console.log(`Creating IAM role: ${roleName}`);
    const resp = await iam.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
        Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
    }));
    await iam.send(new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: "cors-prxy-logs",
        PolicyDocument: LOGS_POLICY,
    }));
    // IAM role propagation delay — wait before using
    console.log("Waiting for IAM role propagation...");
    await new Promise(resolve => setTimeout(resolve, 10_000));
    return resp.Role.Arn;
}
function loadLambdaBundle() {
    const bundlePath = resolve(import.meta.dirname, "lambda-bundle/index.mjs");
    return readFileSync(bundlePath);
}
async function zipBundle(code) {
    // Use a minimal zip implementation — Lambda accepts a zip with a single entry
    // We use Node's built-in zlib + manual zip construction
    const { deflateRawSync } = await import("node:zlib");
    const filename = "index.mjs";
    const filenameBytes = Buffer.from(filename);
    const compressed = deflateRawSync(code);
    const crc = crc32(code);
    // Local file header
    const localHeader = Buffer.alloc(30 + filenameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // compression: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14); // crc32
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(code.length, 22); // uncompressed size
    localHeader.writeUInt16LE(filenameBytes.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28); // extra length
    filenameBytes.copy(localHeader, 30);
    // Central directory header
    const centralDirOffset = localHeader.length + compressed.length;
    const centralHeader = Buffer.alloc(46 + filenameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // compression: deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16); // crc32
    centralHeader.writeUInt32LE(compressed.length, 20); // compressed size
    centralHeader.writeUInt32LE(code.length, 24); // uncompressed size
    centralHeader.writeUInt16LE(filenameBytes.length, 28); // filename length
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(0, 42); // local header offset
    filenameBytes.copy(centralHeader, 46);
    // End of central directory
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0); // signature
    endRecord.writeUInt16LE(0, 4); // disk number
    endRecord.writeUInt16LE(0, 6); // central dir disk
    endRecord.writeUInt16LE(1, 8); // entries on disk
    endRecord.writeUInt16LE(1, 10); // total entries
    endRecord.writeUInt32LE(centralHeader.length, 12); // central dir size
    endRecord.writeUInt32LE(centralDirOffset, 16); // central dir offset
    endRecord.writeUInt16LE(0, 20); // comment length
    return Buffer.concat([localHeader, compressed, centralHeader, endRecord]);
}
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
export async function deploy(config) {
    const lambda = new LambdaClient({ region: config.region });
    const iam = new IAMClient({ region: config.region });
    const tags = buildTags(config);
    const roleName = `cors-prxy-${config.name}-role`;
    const functionName = config.name;
    // 1. Ensure IAM role
    const roleArn = await ensureRole(iam, roleName, tags);
    // 2. Bundle Lambda code
    const bundleCode = loadLambdaBundle();
    const zipBuffer = await zipBundle(bundleCode);
    const envVars = {
        CORS_PRXY_CONFIG: JSON.stringify(config),
    };
    // 3. Create or update Lambda
    let created = false;
    try {
        await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
        // Function exists — update
        console.log(`Updating Lambda function: ${functionName}`);
        await lambda.send(new UpdateFunctionCodeCommand({
            FunctionName: functionName,
            ZipFile: zipBuffer,
        }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: functionName });
        await lambda.send(new UpdateFunctionConfigurationCommand({
            FunctionName: functionName,
            Environment: { Variables: envVars },
            Runtime: "nodejs22.x",
            Handler: "index.handler",
            Role: roleArn,
        }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: functionName });
        // Update tags
        const fn = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
        await lambda.send(new TagResourceCommand({
            Resource: fn.Configuration.FunctionArn,
            Tags: tags,
        }));
    }
    catch (err) {
        if (err.name !== "ResourceNotFoundException")
            throw err;
        // Function doesn't exist — create
        console.log(`Creating Lambda function: ${functionName}`);
        await lambda.send(new CreateFunctionCommand({
            FunctionName: functionName,
            Runtime: "nodejs22.x",
            Handler: "index.handler",
            Role: roleArn,
            Code: { ZipFile: zipBuffer },
            Environment: { Variables: envVars },
            Tags: tags,
            Timeout: 15,
            MemorySize: 128,
            PackageType: "Zip",
        }));
        await waitUntilFunctionActive({ client: lambda, maxWaitTime: 60 }, { FunctionName: functionName });
        created = true;
    }
    // 4. Ensure Function URL
    let endpoint;
    try {
        const urlResp = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: functionName }));
        endpoint = urlResp.FunctionUrl;
    }
    catch {
        console.log("Creating Function URL...");
        const urlResp = await lambda.send(new CreateFunctionUrlConfigCommand({
            FunctionName: functionName,
            AuthType: "NONE",
        }));
        endpoint = urlResp.FunctionUrl;
        // Add public invoke permission
        try {
            await lambda.send(new AddPermissionCommand({
                FunctionName: functionName,
                StatementId: "cors-prxy-public-url",
                Action: "lambda:InvokeFunctionUrl",
                Principal: "*",
                FunctionUrlAuthType: "NONE",
            }));
        }
        catch (err) {
            if (err.name !== "ResourceConflictException")
                throw err;
            // Permission already exists
        }
    }
    console.log(`\nEndpoint: ${endpoint}`);
    return { functionName, endpoint, created };
}
export async function destroy(config) {
    const { DeleteFunctionCommand, DeleteFunctionUrlConfigCommand } = await import("@aws-sdk/client-lambda");
    const { DeleteRoleCommand, DeleteRolePolicyCommand } = await import("@aws-sdk/client-iam");
    const lambda = new LambdaClient({ region: config.region });
    const iam = new IAMClient({ region: config.region });
    const functionName = config.name;
    const roleName = `cors-prxy-${config.name}-role`;
    // Delete Function URL
    try {
        await lambda.send(new DeleteFunctionUrlConfigCommand({ FunctionName: functionName }));
        console.log("Deleted Function URL");
    }
    catch (err) {
        if (err.name !== "ResourceNotFoundException")
            throw err;
    }
    // Delete Lambda
    try {
        await lambda.send(new DeleteFunctionCommand({ FunctionName: functionName }));
        console.log(`Deleted Lambda function: ${functionName}`);
    }
    catch (err) {
        if (err.name !== "ResourceNotFoundException")
            throw err;
    }
    // Delete IAM role
    try {
        await iam.send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: "cors-prxy-logs" }));
        await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
        console.log(`Deleted IAM role: ${roleName}`);
    }
    catch (err) {
        if (err.name !== "NoSuchEntityException")
            throw err;
    }
}
//# sourceMappingURL=deploy.js.map