-- Wave3 G2: allow file + video message types
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_msg_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_msg_type_check
  CHECK (msg_type IN ('text', 'voice', 'image', 'video_note', 'video', 'file'));
