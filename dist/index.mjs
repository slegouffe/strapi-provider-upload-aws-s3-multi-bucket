import { getOr } from 'lodash/fp';
import { S3Client, DeleteObjectCommand, GetObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { isUrlFromBucket, extractCredentials } from './utils.mjs';

const assertUrlProtocol = (url)=>{
    // Regex to test protocol like "http://", "https://"
    return /^\w*:\/\//.test(url);
};
const getConfig = ({ baseUrl, rootPath, s3Options, ...legacyS3Options })=>{
    if (Object.keys(legacyS3Options).length > 0) {
        process.emitWarning("S3 configuration options passed at root level of the plugin's providerOptions is deprecated and will be removed in a future release. Please wrap them inside the 's3Options:{}' property.");
    }
    const credentials = extractCredentials({
        s3Options,
        ...legacyS3Options
    });
    const config = {
        ...s3Options,
        ...legacyS3Options,
        ...credentials ? {
            credentials
        } : {}
    };
    config.params.ACL = getOr(ObjectCannedACL.public_read, [
        'params',
        'ACL'
    ], config);
    return config;
};
var index = {
    init ({ baseUrl, rootPath, s3Options, ...legacyS3Options }) {
        // TODO V5 change config structure to avoid having to do this
        const config = getConfig({
            baseUrl,
            rootPath,
            s3Options,
            ...legacyS3Options
        });
        const s3Client = new S3Client(config);
        const filePrefix = rootPath ? `${rootPath.replace(/\/+$/, '')}/` : '';
        const getFileKey = (file)=>{
            const path = file.path ? `${file.path}/` : '';
            return `${filePrefix}${path}${file.hash}${file.ext}`;
        };
        const upload = async (file, customParams = {})=>{
            const fileKey = getFileKey(file);
            const uploadObj = new Upload({
                client: s3Client,
                params: {
                    Bucket: config.params.Bucket,
                    Key: fileKey,
                    Body: file.stream || Buffer.from(file.buffer, 'binary'),
                    ACL: config.params.ACL,
                    ContentType: file.mime,
                    ...customParams
                }
            });
            const upload = await uploadObj.done();
            if (assertUrlProtocol(upload.Location)) {
                file.url = baseUrl ? `${baseUrl}/${fileKey}` : upload.Location;
            } else {
                // Default protocol to https protocol
                file.url = `https://${upload.Location}`;
            }
        };
        return {
            isPrivate () {
                return config.params.ACL === 'private';
            },
            async getSignedUrl (file, customParams) {
                // Do not sign the url if it does not come from the same bucket.
                if (!isUrlFromBucket(file.url, config.params.Bucket, baseUrl)) {
                    return {
                        url: file.url
                    };
                }
                const fileKey = getFileKey(file);
                const url = await getSignedUrl(// @ts-expect-error - TODO fix client type
                s3Client, new GetObjectCommand({
                    Bucket: config.params.Bucket,
                    Key: fileKey,
                    ...customParams
                }), {
                    expiresIn: getOr(15 * 60, [
                        'params',
                        'signedUrlExpires'
                    ], config)
                });
                return {
                    url
                };
            },
            uploadStream (file, customParams = {}) {
                return upload(file, customParams);
            },
            upload (file, customParams = {}) {
                return upload(file, customParams);
            },
            delete (file, customParams = {}) {
                const command = new DeleteObjectCommand({
                    Bucket: config.params.Bucket,
                    Key: getFileKey(file),
                    ...customParams
                });
                return s3Client.send(command);
            },
            setOptions (bucket, acl) {
                console.log('setBucket - bucket', bucket);
                config.params.Bucket = bucket;
                config.params.ACL = acl;
            }
        };
    }
};

export { index as default };
//# sourceMappingURL=index.mjs.map
