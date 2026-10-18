# Privacy Policy for Dueling Book Enhancer

**Effective date: September 10, 2026**

Dueling Book Enhancer is an unofficial browser extension that provides customization and usability improvements for Dueling Book.

## Information handled by the extension

Dueling Book Enhancer may process and locally store information needed to provide its user-facing features, including:

* Extension preferences, themes, colors, and user-selected background images
* Room visibility and ordering preferences
* Card Pool selections and deck-to-Card-Pool mappings
* Custom banlists and deck-sorting configurations
* User-imported card automation lists and their local enablement/format preferences
* Hosting defaults, including optional duel notes, watch notes, duel passwords, and watch passwords
* Relevant Dueling Book page content, such as card, deck, room, and Card Pool information

The optional duel and watch passwords described above are room access codes. The extension does not access or store the user’s Dueling Book account password.

## Local storage

The add-on keeps a bounded diagnostic history in tab memory (up to 300 entries), including command/event summaries, control clicks and errors. This history clears when the page reloads. Pressing **Ctrl+Alt+Shift+D** or calling the diagnostic download function in the developer console downloads a local JSON file containing that history, game status, automation preferences, player LP/card counts and control visibility. Structured diagnostics omit passwords, chat, account names, card identities, deck contents and raw network messages. Error text and stacks may contain page-provided content. Reports are not uploaded automatically; sharing a report is the user's choice. Downloaded files remain until the user deletes them.

Extension settings are stored locally on the user’s device using Chrome’s extension storage system. Dueling Book Enhancer does not operate a developer-controlled server and does not transmit locally stored settings to the developer.

When a user chooses to host or participate in activity on Dueling Book, information entered or automatically populated into Dueling Book may be submitted to Dueling Book through the website’s normal functionality. That interaction is governed by Dueling Book’s own terms and privacy practices.

## Data sharing and selling

Dueling Book Enhancer does not sell user data.

The extension does not share user information with the developer, advertisers, analytics services, data brokers, or other third parties. It does not contain advertising or analytics tracking.

## Permissions

Dueling Book Enhancer requests access only to Dueling Book and uses that access to provide its interface customization and deck-management features.

The extension uses Chrome’s storage permission to retain user-selected settings between browser sessions.

## Data retention and deletion

If the user chooses to load a rules list from a public raw GitHub URL, the extension
requests optional access to `raw.githubusercontent.com` and downloads that JSON
file. This sends the requested URL and ordinary network metadata to GitHub. No
account credentials or duel/deck data are included. Lists are not downloaded or
updated automatically, and file/string import requires no GitHub access.

Choosing **Validate passcodes and names** requests optional access to
`static.duelingbook.com` and downloads its public card catalog. The request
includes no credentials, rules, or duel/deck data. The catalog is not bundled,
saved, or downloaded automatically. Only identities checked by the user remain
in settings-tab memory until that tab closes. Ordinary import and extension use
do not require this download.

Local rules development is an explicit, session-only option that requests access
to `http://127.0.0.1/*`. While the settings tab remains open, it reads the selected
JSON URL from a locally started development server and saves validated definitions
locally. It sends no account credentials or duel/deck data to that server. The
watcher stops when settings is closed or the user selects Stop watching.

Saved settings remain on the user’s device until they are changed or removed through the extension’s settings or the extension is uninstalled.

Because the developer does not receive or maintain copies of this information, there is no separate developer-controlled database from which user information must be deleted.

## Remote code

Dueling Book Enhancer does not download or execute remotely hosted code. All executable code and bundled banlist data are included within the installed extension package.

## Limited Use compliance

Dueling Book Enhancer’s use of information received from Chrome APIs and Dueling Book adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. Information is used only to provide the extension’s disclosed user-facing functionality.

## Changes to this policy

This policy may be updated if the extension’s functionality or data-handling practices change. Any revised policy will be published at this same location with an updated effective date.

## Contact

Questions about this privacy policy may be sent to:

[john.piegors@gmail.com]

Dueling Book Enhancer is an independent, unofficial project and is not affiliated with or endorsed by Dueling Book.
