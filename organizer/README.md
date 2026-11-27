# NASTI 1 organizer publisher

Install these files in private, spreadsheet-bound Apps Script projects on the separately named Static and Scores spreadsheets. Use the same configuration in both projects. Create Code.gs, Publisher.html, and Shared.html. Shared.html wraps the dashboard’s model.js and crypto.js in a script tag. Refresh this copy whenever either source file changes. Reopen the spreadsheets to load the NASTI 1 menu.

Restrict spreadsheet and script editing to trusted organizers who may publish. Script editors can access the project properties. Configure these Script Properties privately.

| Property | Value |
|---|---|
| STATIC_ID, SCORES_ID | Spreadsheet IDs |
| STATIC_TAB, SCORES_TAB | Data tab names when a spreadsheet has multiple tabs |
| GITHUB_REPO | Owner/repository |
| GITHUB_BRANCH | Branch that serves Pages |
| GITHUB_TOKEN | Fine-grained token restricted to the target repository with Contents write access |
| CSV_KEY | Random 32-byte AES key encoded as unpadded Base64URL |
| ACCESS_EXPIRES | ISO 8601 timestamp including the timezone |

Test in a private staging repository using fake data. Open either menu action to validate both sheets and preview the match template. Before the first publication, import the template into Scores, replacing the arbitrary sample matches. Reopen the preview and click Publish both encrypted files. The ref update publishes one commit containing both ciphertexts. If another update wins or a sheet has changed, reopen the preview.

For attendee access, make a QR code from the HTTPS dashboard URL with the fragment #key= followed by the event key. Generate the QR code privately. The dashboard removes the fragment from the address bar and keeps the key on that browser until sign-out or expiry. Use display names or aliases in Static before publishing.

Keep teams, room order, and round assignments fixed once results are published. Correct score cells and publish again. For a necessary pairing correction after play starts, save the scores privately and have an organizer reconcile the schedule and results before an explicitly authorized reset. Score edits and ordinary key rotation preserve the published schedule lock.

For key rotation, replace CSV_KEY in both projects, publish both files together, and issue a new QR code. After the event, remove the public data files and revoke the publishing token when no longer needed. Earlier ciphertext remains in Git history. A person holding an old ciphertext and its key can still decrypt it. Keep production plaintext out of Git at every stage.
