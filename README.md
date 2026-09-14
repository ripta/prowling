# prowling

A chrome extension that provides a custom PR view in order to tame the
"Conversation" view, which is often a combination of:

- long or conversely, non-existant (empty), PR description
- updates (e.g., new commits, force-pushes)
- human comments, which can be procedural (e.g., talking to a bot, pinging
  another user) or technical (e.g., discussing the contents of the PR)
- bot or CI system comment, which can be procedural (e.g., confirming a user
  request) or technical (e.g., calling out CI failures)
- CI status check, which is usually at the bottom, and requires an extra click
  into a check in order to discover steps or logs

## Development

Since iterating over a Chrome extension is tedious, it may be beneficial to POC
this as a CLI interface first: iterate on the different interface and which
fields to show and how, before attempting to do a Chrome extension.
