import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'node:fs'
import {create} from 'tar'

async function main(): Promise<void> {
    /**
     * The main function for the action.
     * @returns {Promise<void>} Resolves when the action is complete.
     */
    try {
        const localPath: string = core.getInput('local-repository-path', {required: true})
        const apiUrl = new URL(core.getInput('upload-api-url', {required: true}));
        const statusUrl = new URL(core.getInput('status-api-url', {required: true}));
        const deploymentName: string = core.getInput('deployment-name')
        const manualPublishing: boolean = core.getBooleanInput('manual-publishing', {required: true})
        const remoteUsername: string = core.getInput('username', {required: true})
        const remotePassword: string = core.getInput('password', {required: true})
        let tempDir: string = core.getInput('temp-dir')
        if (!tempDir) {
            tempDir = os.tmpdir()
        }
        core.setSecret(remotePassword)

        const bundlePath = path.join(tempDir, 'bundle.tar.gz')

        console.info("Building deployment bundle...");
        await create(
            {
                gzip: true,
                file: bundlePath,
                cwd: localPath,
                onWriteEntry(entry) {
                    console.debug("Added: %s", entry.path);
                },

            },
            fs.readdirSync(localPath)
        )

        if (deploymentName) {
            console.info("Setting deployment name: %s", deploymentName);
            apiUrl.searchParams.set('name', deploymentName)
        }
        if (manualPublishing) {
            console.info("Setting publishing type to USER_MANAGED");
            apiUrl.searchParams.set('publishingType', 'USER_MANAGED')
        }

        const bundleBlob = await fs.openAsBlob(bundlePath)
        const formData = new FormData()
        formData.append('bundle', new File([bundleBlob], "bundle.tar.gz", {type: "application/octet-stream"}))
        const token = btoa(`${remoteUsername}:${remotePassword}`)
        core.setSecret(token)
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: {
                Authorization: `Bearer ${token}`
            }
        })

        const deploymentId = (await getResponseTextSafe(response)).trim();
        if (!response.ok) {
            core.setFailed(
                `Failed to upload bundle to ${apiUrl}: Status ${response.status}\n${deploymentId}`
            )
        } else {
            core.setOutput('deployment-id', deploymentId)
        }

        statusUrl.searchParams.set("id", deploymentId);

        // Poll for up to 60 seconds, which catches nearly all early errors
        const startPolling = new Date();
        const endPolling = new Date(startPolling.getTime() + 60000);
        while (startPolling < endPolling) {
            await snooze(10000);

            const statusResponse = await fetch(statusUrl, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`
                }
            });
            if (!statusResponse.ok) {
                const responseText = await getResponseTextSafe(statusResponse);
                throw new Error("Failed to retrieve status for deployment " + deploymentId + ": " + responseText);
            }

            const statusJson = await statusResponse.json();
            const {deploymentState} = statusJson;
            console.info("Current deployment state: %s", deploymentState);

            if (deploymentState === 'PENDING' || deploymentState === 'VALIDATING') {
                continue;
            }
            if (deploymentState === 'FAILED') {
                core.setFailed("Maven central deployment failed: " + JSON.stringify(statusJson));
            }
            break;
        }
    } catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error) core.setFailed(error)
        throw error;
    }
}

async function getResponseTextSafe(response: Response): Promise<string> {
    try {
        return await response.text()
    } catch (e) {
        return `[failed to retrieve response text: ${e}]`;
    }
}

function snooze(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// noinspection JSIgnoredPromiseFromCall
main()
