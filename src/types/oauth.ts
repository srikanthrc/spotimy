/**
 * OAuth 2.0 Dynamic Client Registration Protocol (RFC 7591)
 * Types for client registration and management
 */

/**
 * Client registration request (RFC 7591 Section 2)
 */
export interface ClientRegistrationRequest {
  redirect_uris?: string[];
  token_endpoint_auth_method?: 'client_secret_post' | 'client_secret_basic' | 'none';
  grant_types?: ('authorization_code' | 'refresh_token')[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: object;
  software_id?: string;
  software_version?: string;
}

/**
 * Client registration response (RFC 7591 Section 3.2.1)
 */
export interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: object;
  software_id?: string;
  software_version?: string;
  registration_access_token?: string;
  registration_client_uri?: string;
}

/**
 * Client registration error response (RFC 7591 Section 3.2.2)
 */
export interface ClientRegistrationErrorResponse {
  error: 'invalid_redirect_uri' | 'invalid_client_metadata' | 'invalid_software_statement' | 'unapproved_software_statement';
  error_description?: string;
}

/**
 * Registered client metadata (stored in database)
 */
export interface RegisteredClient {
  client_id: string;
  client_secret: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  created_at: number;
  registration_access_token?: string;
}
