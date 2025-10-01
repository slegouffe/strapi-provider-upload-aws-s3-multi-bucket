'use strict';

var fp = require('lodash/fp');
var clientS3 = require('@aws-sdk/client-s3');
var s3RequestPresigner = require('@aws-sdk/s3-request-presigner');
var libStorage = require('@aws-sdk/lib-storage');
var utils = require('./utils.js');

const assertUrlProtocol = (url)=>{
    // Regex to test protocol like "http://", "https://"
    return /^\w*:\/\//.test(url);
};
const getConfig = ({ baseUrl, rootPath, s3Options, ...legacyS3Options })=>{
    if (Object.keys(legacyS3Options).length > 0) {
        process.emitWarning("S3 configuration options passed at root level of the plugin's providerOptions is deprecated and will be removed in a future release. Please wrap them inside the 's3Options:{}' property.");
    }
    const credentials = utils.extractCredentials({
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
    config.params.ACL = fp.getOr(clientS3.ObjectCannedACL.public_read, [
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
        const s3Client = new clientS3.S3Client(config);
        const filePrefix = rootPath ? `${rootPath.replace(/\/+$/, '')}/` : '';
        const getFileKey = (file)=>{
            const path = file.path ? `${file.path}/` : '';
            return `${filePrefix}${path}${file.hash}${file.ext}`;
        };
        const upload = async (file, customParams = {})=>{
            try {
                const fileKey = getFileKey(file);
                const uploadObj = new libStorage.Upload({
                    client: s3Client,
                    params: {
                        Bucket: config.params.CustomBucket || config.params.Bucket,
                        Key: fileKey,
                        Body: file.stream || Buffer.from(file.buffer, 'binary'),
                        ACL: config.params.CustomACL || config.params.ACL,
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
            } catch (e) {
                console.log(e);
            }
        };
        return {
            isPrivate () {
                return config.params.ACL === 'private';
            },
            async getSignedUrl (file, customParams) {
                // Do not sign the url if it does not come from the same bucket.
                const bucket = config.params.CustomBucket || config.params.Bucket;
                if (!utils.isUrlFromBucket(file.url, bucket, baseUrl)) {
                    return {
                        url: file.url
                    };
                }
                const fileKey = getFileKey(file);
                const url = await s3RequestPresigner.getSignedUrl(// @ts-expect-error - TODO fix client type
                s3Client, new clientS3.GetObjectCommand({
                    Bucket: config.params.CustomBucket || config.params.Bucket,
                    Key: fileKey,
                    ...customParams
                }), {
                    expiresIn: fp.getOr(15 * 60, [
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
                const command = new clientS3.DeleteObjectCommand({
                    Bucket: config.params.CustomBucket || config.params.Bucket,
                    Key: getFileKey(file),
                    ...customParams
                });
                return s3Client.send(command);
            },
            setOptions (bucket, acl) {
                config.params.CustomBucket = bucket;
                if (acl) {
                    config.params.CustomACL = acl;
                }
            }
        };
    }
};

module.exports = index;
//# sourceMappingURL=index.js.map
