export class SnapshotPublisher {
  constructor(bucket, storage, publish) {
    this.bucket = bucket;
    this.storage = storage;
    this.publish = publish;
    this.queue = Promise.resolve();
  }
  accept(response) {
    const operation = this.queue.then(async () => {
      const generation = response.headers.get('x-backup-generation');
      const sequence = Number(response.headers.get('x-backup-sequence'));
      if (!generation || generation !== await this.storage.get('generation')
          || !Number.isSafeInteger(sequence) || sequence <= 0) {
        await response.body?.cancel();
        throw new Error('The backup belongs to an obsolete or invalid container generation.');
      }
      const cached = await this.storage.get('lastBackup');
      // R2 may have committed its manifest immediately before the DO was reset.
      const committed = await this.bucket.get('lichess/v1/latest.json');
      const previous = committed ? await committed.json() : cached;
      if (previous?.generation === generation && previous.sequence >= sequence) {
        await response.body?.cancel();
        return previous;
      }
      const manifest = await this.publish(this.bucket, response, Date.now(), {generation, sequence});
      await this.storage.put('lastBackup', manifest);
      const history = await this.storage.get('backupHistory') || [];
      const keys = [...history.filter(key => key !== manifest.key), manifest.key];
      await this.storage.put('backupHistory', keys.slice(-10));
      if (keys.length > 10) {
        try {await this.bucket.delete(keys.slice(0, -10));}
        catch (error) {console.warn('Backup retention cleanup failed:', error.message);}
      }
      return manifest;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
