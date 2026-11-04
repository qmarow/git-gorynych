# Семантические ключи Fluent. Сообщения классификатора git совпадают со словарём 1.x (проверяется тестом).

error-protected = The branch is protected on the server — direct push is forbidden
error-protected-hint = Create a separate branch and open a Pull Request, or ask an admin to change the protection rules.

error-hook-declined = The server rejected the push (server hook)
error-hook-declined-hint = See the details: the server usually gives the reason in lines starting with "remote:".

error-forbidden = No write access to this repository
error-forbidden-hint = Your account or token has read-only access. Ask the repository owner for Write access or use a token with the "repo" scope.

error-host-key = SSH: the server key isn't confirmed
error-host-key-hint = Connect once from a terminal (for example, "ssh -T git@github.com") and confirm the server fingerprint.

error-auth = Authorization error on the server
error-auth-hint = Enter a username and password, an access token, or choose an SSH key in the "Repository sign-in" window — the app will remember them for this repository. For HTTPS, the Git Credential Manager window also works; for SSH — a key added to your account on the server.

error-not-found = The repository wasn't found or there's no access to it
error-not-found-hint = Check the remote URL. For private repositories the server answers "not found" if the account has no access.

error-rejected-non-ff = The remote branch has commits you don't have
error-rejected-non-ff-hint = Pull first, or Force Push (with lease) if you're sure you want to overwrite the remote.

error-diverged = The branches have diverged — fast-forward is impossible
error-diverged-hint = Use Pull (fast-forward if possible) or Pull (rebase).

error-conflict = Merge conflicts occurred
error-conflict-hint = Resolve the conflicts in the marked files, then stage them and commit.

error-dirty = Local changes are in the way of the operation
error-dirty-hint = Commit the changes or Stash them, then retry.

error-network = Couldn't connect to the server
error-network-hint = Check your internet connection, VPN or proxy.
