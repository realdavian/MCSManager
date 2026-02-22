# Remote Backup Module - Backlog

Items deferred from current phase, organized for future development.

---

## Phase 2: Restoration

**Status**: Not started  
**Dependency**: Phase 1 complete

### Features
- [ ] Download backup from remote storage
- [ ] Extract backup to instance directory
- [ ] Auto-stop instance if running during restore
- [ ] Restore UI in frontend
- [ ] `backup/restore` API endpoint

### Open Questions
- Should restore overwrite existing files or merge?
- Backup versioning / diff restore?

---

## Phase 3: Additional Providers

**Status**: Not started

### Providers to Consider
- [ ] SFTP / SSH
- [ ] WebDAV
- [ ] Azure Blob Storage
- [ ] Local NAS / Network Share
- [ ] Backblaze B2 (if not S3-compatible enough)

---

## Future Enhancements

### Retention Policy
- [ ] Max backup count per instance
- [ ] Max age for backups
- [ ] Auto-cleanup of old backups

### Backup Improvements
- [ ] Incremental backups
- [ ] Backup encryption
- [ ] Backup compression level options
- [ ] Backup size limits / warnings
- [ ] Pre-backup commands (e.g., "save-all" for Minecraft)

### UI/UX
- [ ] Backup progress in real-time
- [ ] Backup history with details
- [ ] Bulk backup operations (multiple instances)
- [ ] Backup notifications (email, webhook)

---

## Notes

- All items here are out of scope for current phase
- Move items to phase plans when ready to implement
- Add new backlog items as discovered during development
