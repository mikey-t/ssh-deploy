const fs = require('fs-extra')
const { NodeSSH } = require('node-ssh')

class SshDeploy {
  serverAddress
  username
  privateKeyFilePath
  ssh

  constructor(serverAddress, username, privateKeyFilePath) {
    if (!serverAddress || !username || !privateKeyFilePath) {
      throw new Error('all params are required')
    }

    this.serverAddress = serverAddress
    this.username = username
    this.privateKeyFilePath = privateKeyFilePath
    this.ssh = new NodeSSH()
  }

  async connect() {
    console.log(`attempting to ssh to ${this.username}@${this.serverAddress} using key file ${this.privateKeyFilePath}`)

    if (!fs.existsSync(this.privateKeyFilePath)) {
      throw new Error('could not find key file ' + this.privateKeyFilePath)
    }

    await this.ssh.connect({
      host: this.serverAddress,
      username: this.username,
      privateKey: this.privateKeyFilePath
    })

    if (!this.ssh.isConnected()) {
      throw new Error('error: connecting to remote host failed')
    }
  }

  // This seems very fragile but should be an ok start...
  async getServiceStatus(serviceName) {
    if (!serviceName) {
      throw new Error('serviceName is required')
    }

    console.log(`checking if service ${serviceName} is active`)

    const result = await this.ssh.execCommand('sudo systemctl is-active ' + serviceName)

    return result.stdout
  }

  async stopService(serviceName) {
    if (!serviceName) {
      throw new Error('serviceName is required')
    }

    const status = await this.getServiceStatus(serviceName)

    // It may not be ideal to stop a service that may be trying to start, but what this most likely means is that
    // it's in an infinite loop anyway, so we'll go ahead and just stop it.
    //
    // if (status === 'activating') {
    //   throw new Error('service status is activating - let\'s not try stopping it in this state')
    // }

    if (status === 'inactive') {
      console.log('service is already stopped, no action taken')
      return
    }

    console.log(`stopping service ${serviceName} on server ${this.serverAddress}`)

    const result = await this.ssh.execCommand(`sudo systemctl stop ${serviceName}`)

    if (result.code !== 0) {
      console.log('command failed - stdout:')
      console.log(result)
      throw new Error('stopService failed')
    }
  }

  async startService(serviceName) {
    if (!serviceName) {
      throw new Error('serviceName is required')
    }

    console.log(`starting service ${serviceName} on server ${this.serverAddress}`)

    const result = await this.ssh.execCommand('sudo systemctl start ' + serviceName)

    if (result.code !== 0) {
      console.log('command failed - stdout:')
      console.log(result)
      throw new Error('startService failed')
    }
  }

  async transferFileToServer(localFilePath, serverFilePath) {
    if (!localFilePath) {
      throw new Error('localFilePath is required')
    }

    if (!fs.existsSync(localFilePath)) {
      throw new Error('path does not exist for localFilePath: ' + localFilePath)
    }

    console.log(`attempting to send file ${localFilePath} to ${serverFilePath}`)

    await this.ssh.putFile(localFilePath, serverFilePath)

    // An error would have been thrown if not successful
    console.log('successfully transferred file')
  }

  // Suggested serverUnpackDirectoryOwner: www-data
  // For now enforcing serverUnpackDirectory must have 'approot' in it because of how dangerous the command is...
  async unpackTarball(serverTarballPath, serverUnpackDirectory, serverUnpackDirectoryOwner, numPathComponentsToStrip) {
    if (!serverTarballPath || !serverUnpackDirectory || !serverUnpackDirectoryOwner) {
      throw new Error('serverTarballPath and serverUnpackDirectory and serverUnpackDirectoryOwner are required')
    }

    if (serverUnpackDirectory.indexOf('approot') === -1) {
      throw new Error('error: serverUnpackDirectory must contain approot')
    }
    if (serverUnpackDirectory.endsWith('approot') || serverUnpackDirectoryOwner.endsWith('approot/')) {
      throw new Error('error: serverUnpackDirectory must not end with approot')
    }

    const ensureUnpackDirCommand = `sudo -u ${serverUnpackDirectoryOwner} mkdir -p ${serverUnpackDirectory} -m 0755`

    console.log('ensuring directory exists:  ' + serverUnpackDirectory)

    const ensureDirResult = await this.ssh.execCommand(ensureUnpackDirCommand)

    if (ensureDirResult.code !== 0) {
      throw new Error('error: could not create serverUnpackDirectory ' + serverUnpackDirectory + '. result: ' + JSON.stringify(ensureDirResult))
    }

    const deleteExistingFilesCommand = `sudo rm -rf ${serverUnpackDirectory}/*`

    console.log('deleting existing files from server app directory: ' + serverUnpackDirectory)

    const deleteExistingResult = await this.ssh.execCommand(deleteExistingFilesCommand)

    if (!deleteExistingResult.code === 0) {
      throw new Error('error: could not delete existing files from serverUnpackDirectory. result: ' + JSON.stringify(deleteExistingResult))
    }

    const unpackCommand = `sudo tar -xf ${serverTarballPath} -C ${serverUnpackDirectory} --strip-components=${numPathComponentsToStrip || 0}`

    const unpackResult = await this.ssh.execCommand(unpackCommand)

    if (unpackResult.code !== 0) {
      throw new Error('error: could not unpack. result:' + JSON.stringify(unpackResult))
    }
  }

  // Suggested owner and group: www-data
  // Suggested permissions: '0755'
  async recursivelyChangeOwnerAndPermissions(serverDirectory, owner, group, permissions) {
    if (!serverDirectory || !owner || !group || !permissions) {
      throw new Error('all params are required')
    }

    console.log('running chown command')

    const chownCommand = `sudo chown -R ${owner}:${group} ${serverDirectory}`
    const chownResult = await this.ssh.execCommand(chownCommand)

    if (chownResult.code !== 0) {
      throw new Error('error: chown failed. result: ' + JSON.stringify(chownResult))
    }

    console.log('running chmod command')

    const chmodCommand = `sudo chmod -R ${permissions} ${serverDirectory}`

    const chmodResult = await this.ssh.execCommand(chmodCommand)

    if (chmodResult.code !== 0) {
      throw new Error('error: chmod failed. result: ' + JSON.stringify(chmodResult))
    }
  }
  
  async npmInstall(serverAppDir) {
    if (!serverAppDir) {
      throw new Error('serverAppDir is required')
    }
    console.log('running "npm ci --production" in directory ' + serverAppDir)
    
    const result = await this.ssh.execCommand('sudo npm ci --production', {cwd: serverAppDir})
    
    if (result.code !== 0) {
      console.error('error: npm install failed. result: ' + JSON.stringify(result))
    }
  }

  async simpleFileDeploy(serviceName, localTarballPath, serverTempDir, tarballName, serverAppDir, serverAppOwner, numPathStripComponents, appDirPermissions) {
    if (!this.ssh.isConnected()) {
      throw new Error('error: ssh client is not connected - call await connect() method before this method')
    }

    await this.stopService(serviceName)
    await this.transferFileToServer(localTarballPath, `${serverTempDir}/${tarballName}`)
    await this.unpackTarball(`${serverTempDir}/${tarballName}`, serverAppDir, serverAppOwner, numPathStripComponents)
    await this.recursivelyChangeOwnerAndPermissions(serverAppDir, serverAppOwner, serverAppOwner, appDirPermissions)
    await this.startService(serviceName)
  }
  
  async nodeDeploy(serviceName, localTarballPath, serverTempDir, tarballName, serverAppDir, serverAppOwner, numPathStripComponents, appDirPermissions) {
    if (!this.ssh.isConnected()) {
      throw new Error('error: ssh client is not connected - call await connect() method before this method')
    }

    await this.stopService(serviceName)
    await this.transferFileToServer(localTarballPath, `${serverTempDir}/${tarballName}`)
    await this.unpackTarball(`${serverTempDir}/${tarballName}`, serverAppDir, serverAppOwner, numPathStripComponents)
    await this.recursivelyChangeOwnerAndPermissions(serverAppDir, serverAppOwner, serverAppOwner, appDirPermissions)
    await this.npmInstall(serverAppDir)
    await this.startService(serviceName)
  }

  disconnect() {
    this.ssh.dispose()
  }
}

module.exports.SshDeploy = SshDeploy
