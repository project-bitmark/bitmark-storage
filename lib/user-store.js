'use strict'

const KVPFileStore = require('kvplus-files')
const bcrypt = require('bcrypt')

const DEFAULT_SALT_ROUNDS = 5

module.exports = class UserStore {
  constructor (options = {}) {
    this.collectionName = 'users'
    let storeOptions = {
      path: options.path,
      collections: [this.collectionName]
    }
    this.store = new KVPFileStore(storeOptions)
    this.saltRounds = options.saltRounds || DEFAULT_SALT_ROUNDS
  }

  /**
   * @param webId {string} WebID URL of the new user to be created
   * @param options {Object} User options hashmap
   * @param options.password {string} User's signin password.
   * @param [options.email] {string} User's email address (for recovery etc)
   * @param [options.name] {string} User's name
   * @throws {TypeError}
   * @return {Promise<Object>} Resolves to stored user object hashmap
   */
  createUser (webId, options) {
    if (!webId) {
      let error = new TypeError('No WebID Url provided')
      error.status = 400
      return Promise.reject(error)
    }
    if (!options.password) {
      let error = new TypeError('No password provided')
      error.status = 400
      return Promise.reject(error)
    }
    let user = {
      id: webId,
      email: options.email,
      profile: webId,
      name: options.name
    }
    return this.hashPassword(options.password)
      .then(hashedPassword => {
        user.hashedPassword = hashedPassword
        let userKey = encodeURIComponent(webId)
        return this.store.put(this.collectionName, userKey, user)
      })
  }

  /**
   * @param plaintextPassword {string}
   * @throws {Error}
   * @return {Promise<string>}
   */
  hashPassword (plaintextPassword) {
    return new Promise((resolve, reject) => {
      bcrypt.hash(plaintextPassword, this.saltRounds, (err, hashedPassword) => {
        if (err) { return reject(err) }
        resolve(hashedPassword)
      })
    })
  }

  initCollections() {
    this.store.initCollections()
  }
}
