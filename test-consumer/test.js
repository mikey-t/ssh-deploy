const { SshDeploy } = require('@mikeyt23/ssh-deploy')
const fs = require('fs')
const homedir = require('os').homedir()
const path = require('path')
require('dotenv').config()

async function main() {
  const serverAddress = process.env.SSH_SERVER_ADDRESS
  const serverUser = process.env.SSH_SERVER_USER
  const privateKeyPath = path.join(homedir, process.env.PRIVATE_KEY_PARTIAL_PATH)
  const serviceName = process.env.SERVICE_NAME
  const serverTempDir = process.env.SERVER_TEMP_DIR
  const serverAppDir = process.env.SERVER_APP_DIR
  const tarballName = process.env.TARBALL_NAME
  const localTarballPath = 'local_files/' + tarballName
  const serverAppUser = process.env.SERVER_APP_USER
  const numPathStripComponents = 1
  const appDirPermissions = process.env.APP_DIR_PERMISSIONS

  if (!fs.existsSync(privateKeyPath)) {
    console.log('error: privateKeyPath provided does not exist: ' + privateKeyPath)
    return
  }

  const deploy = new SshDeploy(serverAddress, serverUser, privateKeyPath)

  try {
    await deploy.connect()
    await deploy.simpleFileDeploy(
      serviceName,
      localTarballPath,
      serverTempDir,
      tarballName,
      serverAppDir,
      serverAppUser,
      numPathStripComponents,
      appDirPermissions)
  } finally {
    deploy.disconnect()
  }
}

(async () => {
  try {
    await main()
  } catch (err) {
    console.error(err)
    return
  }
})()
