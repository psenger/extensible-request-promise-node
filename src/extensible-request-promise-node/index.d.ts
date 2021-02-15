// Type definitions for extensible-request-promise-node
// Project: https://github.com/psenger/extensible-request-promise-node
// Definitions by: Philip A. Senger <https://github.com/psenger>

declare module 'extensible-request-promise-node' {
    export function get(url: string, queryParams: any, httpOptions:any, queryStringOptions, retryOptions): Promise<any>;
    export function post(url: string, body: any, httpOptions:any,  retryOptions): Promise<any>;

    export class RequestError extends Error {
        constructor(statusCode: number, ...params:any[])
        name: string
    }
    export class AbendError extends Error {
        constructor(statusCode: number, ...params:any[])
        name: string
    }
}
