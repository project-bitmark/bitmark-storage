'use strict'
const OIDClientStore = require('./oidc-client-store')
const OIDCExpressClient = require('anvil-connect-express')
var debug = require('./debug')

/**
 * OIDC Provider
 * Usage:
 *
 *   ```
 *   var providerConfig = {
 *     issuer: 'https://oidc.local',
 *     client_id: 'CLIENT_ID',
 *     client_secret: 'CLIENT_SECRET',
 *     redirect_uri: 'https://ldnode.local:8443/api/oidc/rp'
 *   }
 *   var oidcRpClient = new OidcRpClient()
 *   oidcRpClient.ensureTrustedClient(providerConfig)
 *   ```
 * @class OidcRpClient
 */
module.exports = class OidcRpClient {
  /**
   * @constructor
   * @param [clientStore] {OIDClientStore}
   */
  constructor (clientStore) {
    this.clients = clientStore || new OIDClientStore()
    this.trustedClient = new OIDCExpressClient()
  }

  /**
   * Returns the authorization (signin) URL for a given OIDC client (which
   * is tied to / registered with a specific OIDC Provider).
   * @method authUrl
   * @param oidcClient {OIDCExpressClient}
   * @param workflow {String} OIDC workflow type, one of 'code' or 'implicit'.
   * @return {String} Absolute URL for an OIDC auth call (to start either
   *   the Authorization Code workflow, or the Implicit workflow).
   */
  authUrl (oidcClient, workflow = 'code') {
    let authParams = {
      endpoint: 'signin',
      response_mode: 'query',
      // response_mode: 'form_post',
      client_id: oidcClient.client.client_id,
      redirect_uri: oidcClient.client.redirect_uri,
      // state: '...',  // not doing state for the moment
      scope: 'openid profile'  // not doing 'openid profile' for the moment
    }
    if (workflow === 'code') {  // Authorization Code workflow
      authParams.response_type = 'code'
    } else if (workflow === 'implicit') {
      authParams.response_type = 'id_token token'
      authParams.nonce = '123'  // TODO: Implement proper nonce generation
    }

    var signinUrl = oidcClient.client.authorizationUri(authParams)
    debug.oidc('Signin url: ' + signinUrl)
    return signinUrl
  }

  /**
   * Returns a constructed `/authorization` URL for a given issuer. Used for
   * starting the OIDC workflow.
   * @param issuer {String} OIDC Provider URL
   * @param workflow {String} OIDC workflow type, one of 'code' or 'implicit'
   * @returns {Promise}
   */
  authUrlForIssuer (issuer, workflow = 'code') {
    return this.clientForIssuer(issuer)
      .then((client) => {
        return this.authUrl(client, workflow)
      })
  }

  /**
   * Sends a request to the OIDC Provider's Users API endpoint, to create a new
   * user record with the provider.
   * @method createOIDCUser
   * @param webId {String} WebID URL of the new user to be created
   * @param options {Object} User options hashmap
   * @param options.password {String} User's signin password. NOTE: Must be 8+
   *   characters, mix of alpha and numeric
   * @param [options.email] {String} User's email address (for recovery etc)
   * @param [options.name] {String} User's name
   * @throws {Error} HTTP 400 on missing required params.
   * @return {Promise}
   */
  createOIDCUser (webId, options = {}) {
    if (!webId) {
      let error = new Error('No WebID Url provided')
      error.status = 400
      return Promise.reject(error)
    }
    if (!options.password) {
      let error = new Error('No password provided')
      error.status = 400
      return Promise.reject(error)
    }
    var userData = {
      _id: webId,
      email: options.email,
      profile: webId,
      name: options.name,
      password: options.password
    }
    var client = this.trustedClient.client
    return client
      .token({
        grant_type: 'client_credentials',
        scope: 'realm'
      })
      .then((tokenResponse) => {
        let createOptions = { token: tokenResponse.access_token }
        return client.users.create(userData, createOptions)
      })
      .catch((err) => {
        err.status = err.status || err.statusCode || 400
        err.message = err.error.message || err.error.error
        return Promise.reject(err)
      })
  }

  clientForIssuer (issuer) {
    var trustedClient = this.trustedClient.client
    var baseRedirectUri = trustedClient.redirect_uri
    var isTrustedClient = issuer === trustedClient.issuer
    return this.clients.get(issuer)
      .then((client) => {
        debug.oidc('Client fetched for issuer.')
        if (client) {
          return client
        }
        debug.oidc('Client not present, initializing new client.')
        // client not already in store, create and register it
        let redirectUri = this.redirectUriForIssuer(issuer,
          baseRedirectUri, isTrustedClient)
        let clientConfig = {
          issuer: issuer,
          redirect_uri: redirectUri
        }
        return this.initClient(clientConfig, isTrustedClient)
      })
  }

  /**
   * Ensures that the client for the server's trusted OIDC provider exists in
   * the client store. If it doesn't exist, this method creates, initializes,
   * and registers such a client, and stores it in the client store.
   * @param config {Object} Provider options (client store, local creds)
   * @param config.issuer {String} OIDC Provider/issuer URL
   * @param config.redirect_uri {String} Callback URL invoked by provider
   * @param config.client_id {String} Pre-registered trusted client id
   * @param config.client_secret {String} Pre-registered trusted client secret
   * @param config.post_logout_redirect_uris {Array<String>}
   * @return {Promise<OIDCExpressClient>}
   */
  ensureTrustedClient (config) {
    const self = this
    const issuer = config.issuer
    debug.oidc('Issuer: ' + issuer)
    // First, try to look up client in the store, in case it was persisted
    self.clients.get(issuer)
      .then((client) => {
        debug.oidc('Retrieved trusted client. Issuer: ' + issuer)
        if (client) {
          return client // trusted client already in store
        }
        debug.oidc('Initializing trusted client.')
        // Client not in store, initialize it (initClient also stores it)
        let isTrustedClient = true
        return self.initClient(config, isTrustedClient)
          .then((client) => {
            debug.oidc('Trusted client initialized')
            self.trustedClient = client
            return client
          })
      })
      .catch((err) => {
        debug.oidc('Error initializing trusted client!', err)
      })
  }

  /**
   * Returns an initialized (and registered) instance of an OIDC client for a
   * given set of credentials (issuer/client id, etc).
   * @param config {Object} OIDC Client options hashmap.
   *   `issuer` and `redirect_uris` are required.
   * @param config.issuer {String} URL of the OIDC Provider / issuer
   * @param config.redirect_uri {String}
   * @param [config.client_id] {String} Pre-registered trusted client id
   * @param [config.client_secret] {String} Pre-registered trusted client secret
   * @param [config.post_logout_redirect_uris] {Array<String>}
   * @return {Promise<OIDCExpressClient>} Initialized/registered api client
   */
  initClient (config, isTrustedClient = false) {
    var oidcExpress = new OIDCExpressClient(config)
    // registration spec takes a list of redirect uris. just go with it..
    let redirectUris = [ config.redirect_uri ]
    var registration = this.registrationConfig(config.issuer, redirectUris,
      config.post_logout_redirect_uris)
    debug.oidc('Registration config: ')
    debug.oidc(registration)
    debug.oidc('Running client.initProvider()...')
    return oidcExpress.client.initProvider()
      .then(() => {
        debug.oidc('Client discovered, JWKs retrieved')
        if (!oidcExpress.client.client_id) {
          // Register if you haven't already.
          debug.oidc('Registering client')
          return oidcExpress.client.register(registration)
        } else {
          // Already registered.
          oidcExpress.client.registration = registration
          return oidcExpress
        }
      })
      .then(() => {
        // reg. data is already stored in the client by now
        debug.oidc('Storing registered client')
        return this.clients.put(oidcExpress)
      })
      .then(() => oidcExpress)
      .catch((err) => { throw err })
  }

  redirectUriForIssuer (issuer, baseRedirectUri, isTrustedClient = false) {
    // let buffer = new Buffer(issuer)
    // let issuerId = buffer.toString('base64')
    var redirectUri
    if (isTrustedClient) {
      redirectUri = baseRedirectUri
    } else {
      let issuerId = isTrustedClient ? 'local' : encodeURIComponent(issuer)
      redirectUri = baseRedirectUri + '/' + issuerId
    }
    return redirectUri
  }

  /**
   * @method registrationConfig
   * @param issuer {String} URL of the OIDC Provider / issuer.
   * @param redirectUris {Array<String>} List of allowed URIs to which the
   *   provider will redirect users after login etc.
   * @param [postLogoutUris] {Array<String>}
   * @return {Object} OIDC Client registration config options
   */
  registrationConfig (issuer, redirectUris, postLogoutUris) {
    let clientName = `Solid OIDC Client for ${issuer}`
    let config = {
      client_name: clientName,
      // client_uri: 'https://solid.com',
      // logo_uri: 'solid logo',
      // post_logout_redirect_uris: [ '...' ],
      default_max_age: 86400, // one day in seconds
      // trusted: true,
      // Type of token requests that this client is gonna make
      grant_types: ['authorization_code', 'implicit',
        'refresh_token', 'client_credentials'],
      issuer: issuer,
      redirect_uris: redirectUris,
      response_types: ['code', 'id_token token', 'code id_token token'],
      scope: 'openid profile'
    }
    if (postLogoutUris) {
      config.post_logout_redirect_uris = postLogoutUris
    }
    return config
  }
}
