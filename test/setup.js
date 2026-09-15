// Imported first by every test file, before anything reads the environment.
// Tests run as a made-up manager in Pacific time with no network credentials.
process.env.TIMEZONE = 'America/Los_Angeles';
process.env.MANAGER_NAME = 'Alex';
process.env.WAIVER_DAY = 'Wednesday';
process.env.WAIVER_HOUR = '3';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.BLOB_READ_WRITE_TOKEN;
