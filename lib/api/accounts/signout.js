module.exports = signout

const debug = require('../../debug')

/**
 * Handles the /signout API call.
 * @param req
 * @param res
 */
function signout () {
  return (req, res) => {
    const locals = req.app.locals
    const ldp = locals.ldp
    const userId = req.session.userId
    debug.idp(`Signing out user: ${userId}`)
    const idToken = req.session.idToken
    if (idToken && ldp.auth === 'oidc') {
      const issuer = req.session.issuer
      const oidcRpClient = locals.oidc
      Promise.resolve()
        .then(() => {
          return oidcRpClient.clientForIssuer(issuer)
        })
        .then((userOidcClient) => {
          return userOidcClient.client.signout(idToken)
        })
        .catch((err) => {
          debug.oidc('Error signing out: ', err)
        })
    }
    req.session.userId = ''
    req.session.identified = false
    debug.oidc('signout() finished. Redirecting.')
    res.redirect('/signed_out.html')
    // res.status(200).send('You have been signed out.')
  }
}
