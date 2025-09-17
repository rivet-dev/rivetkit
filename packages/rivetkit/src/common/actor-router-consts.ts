// NOTE: This is in a separate file from the router since it needs to be shared between the client & the server. If this was in the router file, the client would end up importing the *entire* actor router and tree shaking would not work.

// MARK: Paths
export const PATH_CONNECT_WEBSOCKET = "/connect/websocket";
export const PATH_RAW_WEBSOCKET_PREFIX = "/raw/websocket/";

// MARK: Headers
export const HEADER_ACTOR_QUERY = "X-RivetKit-Query";

export const HEADER_ENCODING = "X-RivetKit-Encoding";

// IMPORTANT: Params must be in headers or in an E2EE part of the request (i.e. NOT the URL or query string) in order to ensure that tokens can be securely passed in params.
export const HEADER_CONN_PARAMS = "X-RivetKit-Conn-Params";

// Internal header
export const HEADER_AUTH_DATA = "X-RivetKit-Auth-Data";

export const HEADER_ACTOR_ID = "X-RivetKit-Actor";

export const HEADER_CONN_ID = "X-RivetKit-Conn";

export const HEADER_CONN_TOKEN = "X-RivetKit-Conn-Token";

/**
 * Headers that publics can send from public clients.
 *
 * Used for CORS.
 **/
export const ALLOWED_PUBLIC_HEADERS = [
	"Content-Type",
	"User-Agent",
	HEADER_ACTOR_QUERY,
	HEADER_ENCODING,
	HEADER_CONN_PARAMS,
	HEADER_ACTOR_ID,
	HEADER_CONN_ID,
	HEADER_CONN_TOKEN,
];
