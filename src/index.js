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
     * @param {String} url - The base url with host schema, name, port, password, base url, etc.
     * @param {Object} [queryParams] - query parameters suitable for `querystring.stringify`
     * @param {Object} [httpOptions] - Http Options passed to `http.get`
     * @param {http.Agent|boolean} [httpOptions.agent] - Controls the agent behavior and can be undefined (default) resulting in the `http.globalAgent` for this `host` and `port` see https://nodejs.org/api/http.html#http_class_http_agent, Agent Object, or false which results in a new Agent with default values.
     * @param {String} [httpOptions.auth] - Basic authentication i.e. 'user:password' to compute an Authorization header.
     * @param {Function} [httpOptions.createConnection] - A function that produces a socket/stream to use for the request when the agent option is not used. This can be used to avoid creating a custom Agent class just to override the default createConnection function. See agent.createConnection() for more details. Any Duplex stream is a valid return value.
     * @param {Number} [httpOptions.defaultPort] - The Default port for the protocol. Default: agent.defaultPort if an Agent is used, else undefined.
     * @param {Number} [httpOptions.family] - The IP address family to use when resolving host or hostname. Valid values are 4 or 6. When unspecified, both IP v4 and v6 will be used.
     * @param {Object} [httpOptions.headers] - An object containing request headers.
     * @param {String} [httpOptions.host] - A domain name or IP address of the server to issue the request to. Default: 'localhost'.
     * @param {String} [httpOptions.hostname] - Alias for host. To support url.parse(), hostname will be used if both host and hostname are specified.
     * @param {Boolean} [httpOptions.insecureHTTPParser] - Use an insecure HTTP parser that accepts invalid HTTP headers when true. Using the insecure parser should be avoided. See --insecure-http-parser for more information. Default: false
     * @param {String} [httpOptions.localAddress] - Local interface to bind for network connections.
     * @param {Function} [httpOptions.lookup] - Custom lookup function. Default: dns.lookup().
     * @param {Number} [httpOptions.maxHeaderSize] - Optionally overrides the value of --max-http-header-size for requests received from the server, i.e. the maximum length of response headers in bytes. Default: 16384 (16KB).
     * @param {String} [httpOptions.method=GET] - A string specifying the HTTP request method. Default: 'GET'.
     * @param {String} [httpOptions.path=/] - Request path. Should include query string if any. E.G. '/index.html?page=12'. An exception is thrown when the request path contains illegal characters. Currently, only spaces are rejected but that may change in the future. Default: '/'.
     * @param {Number} [httpOptions.port] - Port of remote server. Default: defaultPort if set, else 80.
     * @param {String} [httpOptions.protocol=http] - Protocol to use. Default: 'http:'
     * @param {Boolean} [httpOptions.setHost=true] -Specifies whether or not to automatically add the Host header. Defaults to true.
     * @param {String} [httpOptions.socketPath] - Unix Domain Socket (cannot be used if one of host or port is specified, those specify a TCP Socket).
     * @param {Number} [httpOptions.timeout] - A number specifying the socket timeout in milliseconds. This will set the timeout before the socket is connected.
     * @param {AbortSignal} [httpOptions.signal] - An AbortSignal that may be used to abort an ongoing request.
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
    /**
     * HTTP Post with data
     * @param {string} url - the URL
     * @param body
     * @param httpOptions
     * @param retryOptions
     * @return {Promise<unknown>}
     */
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
