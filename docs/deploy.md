# Deploying webedit

webedit runs as a Dokku app built from the `Dockerfile`. The first deploy is set up by a wizard:

```sh
scripts/setup-production.sh
```

It walks through registering the Dropbox app (App Folder access, ADR 0003), finding the Owner's account ID, configuring the Dokku app, the storage mount, the first `git push`, HTTPS and the first sign-in.

The wizard never runs anything on the server and never saves a value on your machine. It prints the commands to paste into a shell on the server, and the secrets are generated there. Dokku config is the only copy of every setting. Every value can be recovered or regenerated, so none needs a backup:

| Value | If it is lost |
| --- | --- |
| `WEBEDIT_DROPBOX_APP_KEY`, `WEBEDIT_DROPBOX_APP_SECRET` | Shown again on the app's Settings tab in the Dropbox App Console |
| `WEBEDIT_OWNER_ACCOUNT_ID` | Look it up again (the wizard's stage 5); it never changes |
| `WEBEDIT_SESSION_SECRET` | Generate a new one (below): every device is signed out |
| `WEBEDIT_TOKEN_KEY` | Generate a new one (below): sign in again |

To see which settings are present without printing their values, run `dokku config:keys webedit | grep WEBEDIT_` on the server.

The commands below assume the app is called `webedit`. Run them on the server.

## Rerunning the wizard

Rerunning is safe. Each secret is set only if it's missing, so a rerun never signs anyone out or invalidates the stored token. The public settings are set again to the values you enter. `apps:create` is skipped when the app exists. `storage:mount` reports that the mount already exists, which is fine. Skip the stages you don't need.

## Deploying a new version

```sh
git push dokku master
```

## Rotating the session secret (signs out every device)

```sh
dokku config:set webedit WEBEDIT_SESSION_SECRET="$(openssl rand -base64 48)" >/dev/null
```

The app restarts and every existing session is rejected. The stored Dropbox token is untouched, so signing in again works as usual.

## Rotating the token encryption key (requires signing in again)

The app refuses to start while a `refresh-token` file encrypted with a different key is present. Delete the file before restarting:

```sh
dokku config:set --no-restart webedit WEBEDIT_TOKEN_KEY="$(openssl rand -base64 32)" >/dev/null
sudo rm /var/lib/dokku/data/storage/webedit/refresh-token
dokku ps:restart webedit
```

Then sign in at `/auth/signin` so the server stores a new refresh token encrypted with the new key.

## When something is wrong

- `dokku logs webedit`: at startup the app names every missing or malformed variable. A refused sign-in logs the refused `account_id`.
- `curl https://<domain>/api/health` should return `{"status":"ok"}`.
