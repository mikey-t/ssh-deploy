# @mikeyt23/ssh-deploy

> :warning: **DANGER!** There be dragons here. This package can do serious damage if you misuse it. Or maybe even if you use it properly. 

Don't store any ssh private keys in your project - pull from outside your project directory. Don't check in any secrets or any server info to any of your repositories. Use environment variables or a secret vault or some other mechanism that doesn't require you to expose sensitive information.

You've been warned.

## How

`npm i -D @mikeyt23/ssh-deploy`

Write a script that looks something like the one below. Some variation of this might go in a gulpfile task for example.

```JavaScript
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

```

You should see console output that looks something like this:

```text
attempting to ssh to <redacted>@<redacted> using key file <redacted>
checking if service <redacted> is active
stopping service <redacted> on server <redacted>
attempting to send file local_files/<redacted> to <redacted>
successfully transferred file
ensuring directory exists:  <redacted>
deleting existing files from server app directory: <redacted>
running chown command
running chmod command
starting service <redacted> on server <redacted>
```
