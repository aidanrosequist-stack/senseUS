-- migration: 060_one_reply_per_user_per_comment.sql
--
-- Penetration test round 3 (2026-09-01): a single verified account could
-- insert unlimited replies to the same comment with zero delay - 200
-- replies in ~22ms, reproduced directly against a local replica. Aidan's
-- call: don't limit how many different comments someone replies to, or
-- how deep a real back-and-forth goes - just block repeatedly replying
-- to the exact same comment.
--
-- Threading here is genuinely nested, not flat: Conversation.jsx sets
-- parent_id to the specific comment.id being replied to at every depth
-- (see setReplyingTo, triggered per-CommentCard) - so a real multi-turn
-- conversation naturally produces a new, deeper parent_id on every
-- reply. Repeated inserts against the identical parent_id from the same
-- user is never something a normal conversation does; only flooding
-- does that. That means this can be a hard uniqueness constraint, not a
-- cooldown - same shape as one_top_level_comment_per_user already
-- enforces for top-level comments, just scoped to (user, parent) instead
-- of (user, question).
--
-- A user's own since-deleted reply (is_deleted = true) doesn't count -
-- retracting a reply frees up posting a new one to the same comment,
-- matching how the top-level constraint already interacts with editing.
-- A moderator-removed reply (is_removed = true) still counts, on
-- purpose - a reply actually taken down for cause shouldn't grant an
-- immediate retry to the same target.

CREATE UNIQUE INDEX one_reply_per_user_per_parent
  ON public.comments (user_id, parent_id)
  WHERE parent_id IS NOT NULL AND is_deleted = false;
