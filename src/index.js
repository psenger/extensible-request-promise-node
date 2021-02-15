const HTTP = require('http');
const HTTPS = require('https');
const URL = require('url');
const QUERYSTRING = require('querystring');

const { STATUS_CODES } = HTTP;

class RequestError extends Error {
    constructor(statusCode, ...params) {
        super(...params);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RequestError);
        }
        this.name = 'RequestError';
        this.statusCode = statusCode;
    }
}

class AbendError extends Error {
    constructor(...params) {
        super(...params);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AbendError);
        }
        this.name = 'AbendError';
    }
}

const pick = (object, path, defaultVal) => {
    if ((object === undefined) || (object === null) || (path === undefined) || (path === null)) {
        return defaultVal;
    }
    const names = path.split('.').reverse();
    while (names.length && (object = object[names.pop()]) !== undefined && object !== null) {
    }
    // Handle cases where accessing a childprop of a null value
    if (object === null && names.length) object = undefined;
    return (object === undefined ? defaultVal : object);
};

const isRequired = (value) => {
    throw new Error(`The parameter '${value}' is required`);
};

const isBlank = value => ((value || '').toString().trim() === '');

const protocolHelper = uri => ((uri.toLowerCase().startsWith('https')) ? HTTPS : HTTP);

const compose = (...fns) => args => fns.reduce((p, f) => p.then(f), Promise.resolve(args));

const wait = interval => new Promise(resolve => setTimeout(resolve, interval));

const retry = function retry(fn, retries = 3, interval = 200) {
    const retriesLeft = retries;
    return new Promise((resolve, reject) => fn()
        .then(resolve)
        .catch((error) => {
            if (error.name === 'RequestError' && error.statusCode !== 504) {
                return reject(error);
            }
            if (retriesLeft <= 0) {
                return reject(error);
            }
            return wait(interval)
                .then(() => retry(fn, retriesLeft - 1, interval * 2))
                .then(resolve, reject);
        }));
};

const request = compose(
    (options) => {
        options.headers = options.headers || {};
        options.headers['content-length'] = options.body ? Buffer.byteLength(options.body) : 0
        return options;
    },
    options => new Promise((resolve, reject) => {
        // console.log(`Posting ${JSON.stringify(options,null,4)}`);
        const res = protocolHelper(options.protocol)
            .request(options)
            .on('response', resolve)
            .on('error', reject)
        if ( options.body ) {
            res.write(options.body)
            res.end();
        } else {
            res.end();
        }
    }),
    res => new Promise((resolve, reject) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume(); // @TODO: Not sure this will work with retry... need to test it
            const e = new RequestError(res.statusCode, STATUS_CODES[res.statusCode.toString()]);
            return reject(e);
        }
        let body = '';
        res
            .on('data', chunk => body += chunk)
            .on('end', () => {
                if (!res.complete) {
                    // rare circumstance that the event `end` fired but the response was incomplete
                    const error = new AbendError('Connection terminated while message was being received');
                    return reject(error);
                }
                return resolve({ res, body });
            })
            .on('error', reject);
    }),
    ({ res, body }) => {
        const { statusCode, headers } = res;
        let [mime, encoding] = (headers['content-type'] || '').split(';');
        mime = (mime || 'text/plain').trim().toLowerCase();
        [, encoding] = (encoding || 'charset=utf-8').trim().toLowerCase().split('=');
        if (mime.startsWith('application/json')) {
            return ({ res, statusCode, headers, body: JSON.parse(Buffer.from(body, encoding).toString(encoding)) });
        }
        return ({ res, statusCode, headers, body });
    },
);

module.exports = {
    /**
     * HTTP Get with a Path, Options are the NodeJS HttpOptions.
     * @param {String} url - the base url
     * @param {Object} [queryParams] - query parameters suitable for `querystring.stringify`
     * @param {HttpOptions} [httpOptions] - Http Options passed to `http.get`
     * @param {QueryStringOptions} [queryStringOptions] - Http Options passed to `querystring.stringify`
     * @return {Promise<unknown>}
     */
    get: async function get(url = isRequired('url'), queryParams, httpOptions, queryStringOptions, retryOptions) {
        const qs = QUERYSTRING.stringify(
            queryParams,
            pick(queryStringOptions, 'sep'),
            pick(queryStringOptions, 'eq'),
            pick(queryStringOptions, 'options'),
        );
        const requestOptions = Object.assign(
            {},
            { method: 'GET' },
            URL.parse(`${url}${isBlank(qs) ? '' : '?'}${qs}`),
            httpOptions,
        );
        const interval = pick(retryOptions, 'interval');
        const retries = pick(retryOptions, 'retries');
        return retry(() => request(requestOptions), retries, interval);
    },
    post: async function post(url = isRequired('url'), body, httpOptions, retryOptions) {
        const requestOptions = Object.assign(
            {},
            { method: 'POST', body },
            URL.parse(url),
            httpOptions,
        );
        const interval = pick(retryOptions, 'interval');
        const retries = pick(retryOptions, 'retries');
        return retry(() => request(requestOptions), retries, interval);
    },
    RequestError,
    AbendError
};
