import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'node:fs'
import { create } from 'tar'

async function main(): Promise<void> {
  /**
   * The main function for the action.
   * @returns {Promise<void>} Resolves when the action is complete.
   */
  try {
    const localPath: string = core.getInput('local-repository-path')
    const apiUrl: string = core.getInput('api-url')
    const deploymentName: string = core.getInput('deployment-name')
    const manualPublishing: boolean = core.getBooleanInput('manual-publishing')
    const remoteUsername: string = core.getInput('remote-repository-username')
    const remotePassword: string = core.getInput('remote-repository-password')
    let tempDir: string = core.getInput('temp-dir')
    if (!tempDir) {
      tempDir = os.tmpdir()
    }
    core.setSecret(remotePassword)

    const bundlePath = path.join(tempDir, 'bundle.tar.gz')

    await create(
      {
        gzip: true,
        file: bundlePath,
        cwd: localPath
      },
      ['.']
    )

    const bundleBlob = new Blob([fs.readFileSync(bundlePath)])

    const formData = new FormData()
    formData.append('bundle', bundleBlob)
    if (deploymentName) {
      formData.append('name', deploymentName)
    }
    if (manualPublishing) {
      formData.append('publishingType', 'USER_MANAGED')
    }
    const token = btoa(`${remoteUsername}:${remotePassword}`)
    core.setSecret(token)
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    let responseText = ''
    try {
      responseText = await response.text()
    } catch {
      // Ignored
    }

    if (!response.ok) {
      core.setFailed(
        `Failed to upload bundle to ${apiUrl}: Status ${response.status}\n${responseText}`
      )
    } else {
      core.setOutput('deployment-id', responseText.trim())
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error)
      throw error;
  }
}

// noinspection JSIgnoredPromiseFromCall
main()
