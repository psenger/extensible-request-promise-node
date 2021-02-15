/* eslint-disable max-len,object-curly-newline */
const nock = require('nock');
const { get, post, RequestError } = require('../extensible-request-promise-node');
const { STATUS_CODES } = require('http');

/**
 * pluck values from an object.
 * @param {Object} [obj={}] - an Object, null and undefined return an empty obj literal.
 * @param {[String]} [keys=[]] - an array of keys to plunk from the object.
 * @return {Object}
 */
const pluck = (obj = {}, keys = []) => (keys || []).reduce((ac, key) => {
    // eslint-disable-next-line no-param-reassign
    ac[key] = (obj) ? obj[key] : undefined;
    return ac;
}, {});

describe('requestPromise', () => {
    let scope = null;
    const sampleHtmlError = '<html><body>504 Gateway Timeout</body></html>';
    const sampleText = 'all good';
    const sampleObject = { msg: sampleText };
    const sampleErrorText = 'Error: you made mr monkey go boom boom';
    const sampleErrorObject = { error: sampleErrorText };
    const textHeaders = { 'content-type': 'text/plain' };
    const jsonHeaders = { 'content-type': 'application/json' };
    const htmlHeaders = { 'content-type': 'text/html' };
    const buildServerHeaderPairs = ( value, mimeType = 'text/plain' ) => {
        return [
            ['content-type', ( typeof value === 'string' ) ? mimeType : 'application/json' ],
            ['content-length', Buffer.byteLength( ( typeof value === 'string' ) ? value : JSON.stringify(value) )]
        ]
    }
    const buildPostClientHeaderPairs = ( value, mimeType = 'text/plain' ) => {
        return [
            ['content-type', ( typeof value === 'string' ) ? mimeType : 'application/json' ],
            ['accept', '*/*'],
            ['content-length', Buffer.byteLength( ( typeof value === 'string' ) ? value : JSON.stringify(value) )]
        ]
    }
    const buildGetClientHeaderPairs = ( ) => {
        return [
            ['accept', '*/*']
        ]
    }
    const buildHeaderObject = pairs => pairs.reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
    }, {});
    describe('#get', () => {
        describe.each([
            ['With the protocol set to https', 'https'],
            ['With the protocol set to HTTPS', 'HTTPS'],
            ['With the protocol set to http', 'http'],
            ['With the protocol set to HTTP', 'HTTP'],
        ])('%s', (name, protocol) => {
            const basepath = `${protocol}://www.example.com:9192`;
            beforeEach(() => {
                scope = nock(basepath);
            });
            afterEach(() => {
                nock.cleanAll();
                nock.abortPendingRequests();
            });
            test
                .each([
                    [
                        `It should handle a string '${sampleText}' and statusCode 200`,
                        { replyStatusCode: 200, replyHttpResponse: sampleText, replyHeaders: buildHeaderObject(buildServerHeaderPairs(sampleText)), matchedHeaders: buildGetClientHeaderPairs() },
                        { expectedHttpStatus: 200, expectedResponse: sampleText, expectedResponseHeaders: textHeaders, expectedException: false },
                        { getHeaders: buildHeaderObject(buildGetClientHeaderPairs()) }
                    ],
                    [
                        `It should handle an object '${JSON.stringify(sampleObject)}' and statusCode 200`,
                        { replyStatusCode: 200, replyHttpResponse: JSON.stringify(sampleObject), replyHeaders: buildHeaderObject(buildServerHeaderPairs(sampleObject)), matchedHeaders: buildGetClientHeaderPairs() },
                        { expectedHttpStatus: 200, expectedResponse: sampleObject, expectedResponseHeaders: jsonHeaders, expectedException: false },
                        { getHeaders: buildHeaderObject(buildGetClientHeaderPairs()) }
                    ],
                    [
                        `It should handle a string '${sampleErrorText}' and exception when statusCode 401`,
                        { replyStatusCode: 401, replyHttpResponse: sampleErrorText, replyHeaders: buildHeaderObject(buildServerHeaderPairs(sampleErrorText)), matchedHeaders: buildGetClientHeaderPairs() },
                        { expectedHttpStatus: 401, expectedResponse: sampleErrorText, expectedResponseHeaders: textHeaders, expectedException: true },
                        { getHeaders: buildHeaderObject(buildGetClientHeaderPairs()) }
                    ],
                    [
                        `It should handle an object '${JSON.stringify(sampleErrorObject)}' and exception when statusCode 401`,
                        { replyStatusCode: 401, replyHttpResponse: JSON.stringify(sampleErrorObject), replyHeaders: buildHeaderObject(buildServerHeaderPairs(sampleErrorObject)), matchedHeaders: buildGetClientHeaderPairs() },
                        { expectedHttpStatus: 401, expectedResponse: sampleErrorObject, expectedResponseHeaders: jsonHeaders, expectedException: true },
                        { getHeaders: buildHeaderObject(buildGetClientHeaderPairs()) }
                    ],
                    [
                        `It should handle an messed gateway timeout "${sampleHtmlError}" and exception when statusCode 504`,
                        { replyStatusCode: 504, replyHttpResponse: `${sampleHtmlError}`, replyHeaders: buildHeaderObject(buildServerHeaderPairs(sampleHtmlError, 'text/html')), matchedHeaders: buildGetClientHeaderPairs() },
                        { expectedHttpStatus: 504, expectedResponse: `${sampleHtmlError}`, expectedResponseHeaders: htmlHeaders, expectedException: true },
                        { getHeaders: buildHeaderObject(buildGetClientHeaderPairs()) }
                    ],
                ])('%s', async (testMessage,
                                { replyStatusCode, replyHttpResponse, replyHeaders, matchedHeaders },
                                { expectedHttpStatus, expectedResponse, expectedResponseHeaders, expectedException },
                                { getHeaders }
                ) => {
                    matchedHeaders.reduce( (acc, value)=> acc.matchHeader(...value), scope.get('/resource') )
                        .reply(replyStatusCode, replyHttpResponse, replyHeaders);

                    if (expectedException) {
                        expect.assertions(1);
                        const error = new RequestError(expectedHttpStatus, STATUS_CODES[expectedHttpStatus]);
                        return expect(get(`${basepath}/resource`, {}, { headers: getHeaders }, {}, { retries: 0 }))
                            .rejects
                            .toMatchObject(error);
                    }
                    expect.assertions(2);
                    const { body, headers, statusCode } = await get(
                        `${basepath}/resource`,
                        {},
                        {
                            headers: getHeaders,
                        },
                        {},
                        { retries: 0 },
                    );
                    expect({ body, headers, statusCode }).toMatchObject({ body: expectedResponse, statusCode: expectedHttpStatus });
                    expect(scope.isDone()).toEqual(true);
                    return Promise.resolve();
                });
            test('It should construct a complex query parameters', async () => {
                expect.assertions(2);
                const queryParams = {
                    names: ['alice', 'bob'],
                    tags: JSON.stringify({
                        alice: ['admin', 'tester'],
                        bob: ['tester'],
                    }),
                };
                const expectedResults = {
                    message: 'hello world',
                };
                scope
                    .get('/complexQueryParams')
                    .query((actualQueryObject) => {
                        expect(actualQueryObject).toMatchObject(queryParams);
                        return true;
                    })
                    .reply(200, expectedResults);
                let results = await get(`${basepath}/complexQueryParams`, queryParams, {}, {}, { retries: 0 });
                results = pluck(results, ['statusCode', 'body']);
                return expect(results).toMatchObject({ body: expectedResults, statusCode: 200 });
            });
            test('It should handle connection refused with a rejected error', async () => {
                const error = new Error();
                error.code = 'ECONNREFUSED';
                scope
                    .get('/connectionrefused')
                    // 1 seconds delay will be applied to the response header and body
                    .delay({ head: 1000, body: 1000 })
                    .replyWithError(error);
                return expect(get(`${basepath}/connectionrefused`, {}, {},{}, { retries: 0 }))
                    .rejects
                    .toMatchObject(error);
            }, 3000);
            test('It should handle connection reset by peer with a rejected error', async () => {
                const error = new Error();
                error.code = 'ECONNRESET';
                scope
                    .get('/connectionresetbypeer')
                    // 1 seconds delay will be applied to the response header and body
                    .delay({ head: 1000, body: 1000 })
                    .replyWithError(error);
                return expect(get(`${basepath}/connectionresetbypeer`, {}, {},{}, { retries: 0 }))
                    .rejects
                    .toMatchObject(error);
            }, 3000);
            test('It should handle operation timed out with a rejected error', async () => {
                const error = new Error();
                error.code = 'ETIMEDOUT';
                scope
                    .get('/connectiontimeout')
                    // 1 seconds delay will be applied to the response header and body
                    .delay({ head: 1000, body: 1000 })
                    .replyWithError(error);
                return expect(get(`${basepath}/connectiontimeout`,{},{},{},{ retries: 0 }))
                    .rejects
                    .toMatchObject(error);
            }, 3000);
            test('It should pass the headers correctly', async () => {
                expect.assertions(2);
                scope
                    .matchHeader('A', 'AAAAAA')
                    .matchHeader('B', 'BBBBBB')
                    .matchHeader('content-type', 'application/json')
                    .get('/headertest')
                    .reply(200, {
                        message: 'hello world',
                    });
                const result = await get(`${basepath}/headertest`, {}, {
                    headers: {
                        A: 'AAAAAA',
                        B: 'BBBBBB',
                        'content-type': 'application/json',
                    },
                },{});
                expect(result).toMatchObject({ body: { message: 'hello world' }, statusCode: 200 });
                expect(scope.isDone()).toEqual(true);
            });
        });
    });
    describe('#post', () => {
        describe.each([
            ['With the protocol set to https', 'https'],
            ['With the protocol set to HTTPS', 'HTTPS'],
            ['With the protocol set to http', 'http'],
            ['With the protocol set to HTTP', 'HTTP'],
        ])('%s', (name, protocol) => {
            const basepath = `${protocol}://www.example.com:9192`;
            beforeEach(() => {
                scope = nock(basepath);
            });
            afterEach(() => {
                nock.cleanAll();
                nock.abortPendingRequests();
            });
            test
                .each([
                    [
                        `It should handle a string '${sampleText}' and statusCode 200`,
                        { replyStatusCode: 200,    replyHttpResponse: sampleText, replyHeaders: textHeaders, matchedBody: sampleText, matchedHeaders: buildPostClientHeaderPairs(sampleText) },
                        { expectedHttpStatus: 200, expectedResponse: sampleText, expectedResponseHeaders: textHeaders, expectedException: false },
                        { postBody: sampleText, postHeaders: buildHeaderObject(buildPostClientHeaderPairs(sampleText)) }
                    ],
                    [
                        `It should handle an object '${JSON.stringify(sampleObject)}' and statusCode 200`,
                        { replyStatusCode: 200,    replyHttpResponse: JSON.stringify(sampleObject), replyHeaders: jsonHeaders, matchedBody: JSON.stringify(sampleObject), matchedHeaders: buildPostClientHeaderPairs(sampleObject) },
                        { expectedHttpStatus: 200, expectedResponse: sampleObject,                 expectedResponseHeaders: jsonHeaders, expectedException: false },
                        { postBody: JSON.stringify(sampleObject), postHeaders: buildHeaderObject(buildPostClientHeaderPairs(sampleObject)) }
                    ],
                    [
                        `It should handle a string '${sampleErrorText}' and exception when statusCode 401`,
                        { replyStatusCode: 401,    replyHttpResponse: sampleErrorText, replyHeaders: textHeaders,     matchedBody: sampleText, matchedHeaders:  buildPostClientHeaderPairs(sampleText) },
                        { expectedHttpStatus: 401, expectedResponse: sampleErrorText,  expectedResponseHeaders: textHeaders, expectedException: true },
                        { postBody: sampleText, postHeaders: buildHeaderObject(buildPostClientHeaderPairs(sampleText)) }
                    ],
                    [
                        `It should handle an object '${JSON.stringify(sampleObject)}' and exception when statusCode 401`,
                        { replyStatusCode: 401,    replyHttpResponse: JSON.stringify(sampleErrorObject), replyHeaders: jsonHeaders,     matchedBody: JSON.stringify(sampleObject), matchedHeaders: buildPostClientHeaderPairs(sampleObject)  },
                        { expectedHttpStatus: 401, expectedResponse: sampleErrorObject,                 expectedResponseHeaders: jsonHeaders, expectedException: true },
                        { postBody: JSON.stringify(sampleObject), postHeaders: buildHeaderObject(buildPostClientHeaderPairs(sampleObject)) }
                    ],
                    [
                        `It should handle an messed gateway timeout "${sampleHtmlError}" and exception when statusCode 504`,
                        { replyStatusCode: 504,    replyHttpResponse: `${sampleHtmlError}`, replyHeaders: htmlHeaders, matchedBody: JSON.stringify(sampleObject), matchedHeaders: buildPostClientHeaderPairs(sampleObject) },
                        { expectedHttpStatus: 504, expectedResponse: `${sampleHtmlError}`,  expectedResponseHeaders: htmlHeaders, expectedException: true },
                        { postBody: JSON.stringify(sampleObject),  postHeaders: buildHeaderObject(buildPostClientHeaderPairs(sampleObject)) }
                    ],
                ])('%s', async (testMessage,
                                { replyStatusCode, replyHttpResponse, replyHeaders, matchedBody, matchedHeaders },
                                { expectedHttpStatus, expectedResponse, expectedResponseHeaders, expectedException },
                                { postBody, postHeaders }
                ) => {

                    matchedHeaders.reduce( (acc, value)=> acc.matchHeader(...value), scope.post('/resource', matchedBody) )
                        .reply(replyStatusCode, replyHttpResponse, replyHeaders);

                    if (expectedException) {
                      expect.assertions(1);
                      const error = new RequestError(expectedHttpStatus, STATUS_CODES[expectedHttpStatus]);
                      return expect(post(`${basepath}/resource`,
                          postBody,
                          { headers: postHeaders },
                          { retries: 0 }))
                        .rejects
                        .toMatchObject(error);
                    }
                    expect.assertions(2);
                    let results = await post(
                        `${basepath}/resource`,
                        matchedBody,
                        { headers: postHeaders },
                        { retries: 0 },
                    );
                    results = pluck(results, ['statusCode', 'body', 'headers']);
                    expect(results).toMatchObject({ body: expectedResponse, statusCode: expectedHttpStatus, headers: expectedResponseHeaders });
                    expect(scope.isDone()).toEqual(true);
                    return Promise.resolve();
                });
            test('It should handle connection refused with a rejected error', async () => {
              const error = new Error();
              error.code = 'ECONNREFUSED';
              scope
                .post('/connectionrefused', sampleObject)
                // 1 seconds delay will be applied to the response header and body
                .delay({ head: 1000, body: 1000 })
                .replyWithError(error);
              return expect(post(`${basepath}/connectionrefused`,
                   JSON.stringify(sampleObject),
                  { headers: { 'content-type': 'application/json', 'accept': '*/*', 'content-length': Buffer.byteLength(JSON.stringify(sampleObject)) } },
                  { retries: 0 },
                  ))
                .rejects
                .toMatchObject(error);
            }, 3000);
            test('It should handle connection reset by peer with a rejected error', async () => {
              const error = new Error();
              error.code = 'ECONNRESET';
              scope
                .post('/connectionresetbypeer', sampleObject)
                // 1 seconds delay will be applied to the response header and body
                .delay({ head: 1000, body: 1000 })
                .replyWithError(error);
              return expect(post(`${basepath}/connectionresetbypeer`,
                  JSON.stringify(sampleObject),
                  { headers: { 'content-type': 'application/json', 'accept': '*/*', 'content-length': Buffer.byteLength(JSON.stringify(sampleObject)) } },
                  { retries: 0 },
                ))
                .rejects
                .toMatchObject(error);
            }, 3000);
            test('It should handle operation timed out with a rejected error', async () => {
              const error = new Error();
              error.code = 'ETIMEDOUT';
              scope
                .post('/connectiontimeout', sampleObject)
                // 1 seconds delay will be applied to the response header and body
                .delay({ head: 1000, body: 1000 })
                .replyWithError(error);
              return expect(post(`${basepath}/connectiontimeout`,
                  JSON.stringify(sampleObject),
                  { headers: { 'content-type': 'application/json', 'accept': '*/*', 'content-length': Buffer.byteLength(JSON.stringify(sampleObject)) } },
                  { retries: 0 },
                  ))
                .rejects
                .toMatchObject(error);
            }, 3000);
            test('It should pass the headers correctly', async () => {
              expect.assertions(2);
              scope
                .matchHeader('a', 'AAAAAA')
                .matchHeader('b', 'BBBBBB')
                .matchHeader('content-type', 'application/json')
                .matchHeader('accept', '*/*')
                .matchHeader('content-length', Buffer.byteLength(JSON.stringify(sampleObject)))
                .post('/headertest', sampleObject)
                .reply(200, {
                  message: 'hello world',
                });
                let result = await post(`${basepath}/headertest`,
                    JSON.stringify(sampleObject),
                    {
                        headers: {
                            A: 'AAAAAA',
                            B: 'BBBBBB',
                            'content-type': 'application/json',
                            'accept': '*/*',
                            'content-length': Buffer.byteLength(JSON.stringify(sampleObject))
                        }
                    },
                    {retries: 0}
                );
              result = pluck(result,['body','headers','statusCode'])
              expect(result).toMatchObject({ body: { message: 'hello world' }, headers: {"content-type": "application/json"}, statusCode: 200 });
              expect(scope.isDone()).toEqual(true);
            });
        });
    });
});
