--
-- PostgreSQL database dump
--

\restrict OqVnH2xTi568YScARABEicDCufThPAOgUDlLvqhpdlV7pXeLUmNIwpoPE1wkDaX

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    type text NOT NULL,
    post_id uuid,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


ALTER TABLE public.activities OWNER TO hub;

--
-- Name: attention_gifts; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.attention_gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    post_id uuid,
    sticker text DEFAULT '✨'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.attention_gifts OWNER TO hub;

--
-- Name: blocks; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blocks_check CHECK ((blocker_id <> blocked_id))
);


ALTER TABLE public.blocks OWNER TO hub;

--
-- Name: bookmark_folders; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.bookmark_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookmark_folders_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60)))
);


ALTER TABLE public.bookmark_folders OWNER TO hub;

--
-- Name: bot_callbacks; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.bot_callbacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bot_id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid NOT NULL,
    data text DEFAULT ''::text NOT NULL,
    answered_at timestamp with time zone,
    answer_text text DEFAULT ''::text NOT NULL,
    show_alert boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.bot_callbacks OWNER TO hub;

--
-- Name: bot_updates; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.bot_updates (
    id bigint NOT NULL,
    bot_id uuid NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.bot_updates OWNER TO hub;

--
-- Name: bot_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: hub
--

CREATE SEQUENCE public.bot_updates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bot_updates_id_seq OWNER TO hub;

--
-- Name: bot_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: hub
--

ALTER SEQUENCE public.bot_updates_id_seq OWNED BY public.bot_updates.id;


--
-- Name: bots; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.bots (
    user_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    token_hash text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    commands jsonb DEFAULT '[]'::jsonb NOT NULL,
    webapp_url text DEFAULT ''::text NOT NULL,
    webapp_title text DEFAULT ''::text NOT NULL,
    allow_groups boolean DEFAULT false NOT NULL,
    webhook_url text DEFAULT ''::text NOT NULL,
    webhook_secret text DEFAULT ''::text NOT NULL,
    webhook_last_error text DEFAULT ''::text NOT NULL,
    webhook_last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.bots OWNER TO hub;

--
-- Name: call_participants; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.call_participants (
    call_id uuid NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'ringing'::text NOT NULL,
    video boolean DEFAULT false NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_participants_state_check CHECK ((state = ANY (ARRAY['ringing'::text, 'joined'::text, 'left'::text, 'declined'::text, 'missed'::text])))
);


ALTER TABLE public.call_participants OWNER TO hub;

--
-- Name: calls; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    initiator_id uuid NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    video boolean DEFAULT false NOT NULL,
    status text DEFAULT 'ringing'::text NOT NULL,
    outcome text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    CONSTRAINT calls_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'active'::text, 'ended'::text])))
);


ALTER TABLE public.calls OWNER TO hub;

--
-- Name: channel_join_log; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_join_log (
    user_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.channel_join_log OWNER TO hub;

--
-- Name: channel_members; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_members (
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


ALTER TABLE public.channel_members OWNER TO hub;

--
-- Name: channel_post_comments; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    reply_to_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.channel_post_comments OWNER TO hub;

--
-- Name: channel_post_reactions; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_post_reactions (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.channel_post_reactions OWNER TO hub;

--
-- Name: channel_post_views; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_post_views (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.channel_post_views OWNER TO hub;

--
-- Name: channel_posts; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channel_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.channel_posts OWNER TO hub;

--
-- Name: channels; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    rules text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    comments_enabled boolean DEFAULT true NOT NULL
);


ALTER TABLE public.channels OWNER TO hub;

--
-- Name: chat_poll_votes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.chat_poll_votes (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    option_idx smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_poll_votes_option_idx_check CHECK (((option_idx >= 0) AND (option_idx < 10)))
);


ALTER TABLE public.chat_poll_votes OWNER TO hub;

--
-- Name: chat_polls; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.chat_polls (
    message_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    creator_id uuid,
    question text NOT NULL,
    options jsonb NOT NULL,
    multiple boolean DEFAULT false NOT NULL,
    anonymous boolean DEFAULT true NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.chat_polls OWNER TO hub;

--
-- Name: clip_likes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.clip_likes (
    clip_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.clip_likes OWNER TO hub;

--
-- Name: clips; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    media_url text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.clips OWNER TO hub;

--
-- Name: close_friends; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.close_friends (
    owner_id uuid NOT NULL,
    friend_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT close_friends_check CHECK ((owner_id <> friend_id))
);


ALTER TABLE public.close_friends OWNER TO hub;

--
-- Name: comments; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.comments OWNER TO hub;

--
-- Name: conversation_invites; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_invites (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversation_invites OWNER TO hub;

--
-- Name: conversation_members; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_members (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    pinned_at timestamp with time zone,
    archived_at timestamp with time zone,
    folder text DEFAULT 'inbox'::text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    last_delivered_at timestamp with time zone,
    CONSTRAINT conversation_members_folder_check CHECK ((folder = ANY (ARRAY['inbox'::text, 'important'::text, 'archive'::text]))),
    CONSTRAINT conversation_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


ALTER TABLE public.conversation_members OWNER TO hub;

--
-- Name: conversation_mutes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_mutes (
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversation_mutes OWNER TO hub;

--
-- Name: conversation_read_log; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_read_log (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone NOT NULL
);


ALTER TABLE public.conversation_read_log OWNER TO hub;

--
-- Name: conversation_topic_mutes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_topic_mutes (
    topic_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversation_topic_mutes OWNER TO hub;

--
-- Name: conversation_topic_reads; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_topic_reads (
    topic_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone NOT NULL
);


ALTER TABLE public.conversation_topic_reads OWNER TO hub;

--
-- Name: conversation_topics; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversation_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    title text NOT NULL,
    icon text DEFAULT ''::text NOT NULL,
    color text DEFAULT 'blue'::text NOT NULL,
    is_general boolean DEFAULT false NOT NULL,
    closed_at timestamp with time zone,
    pinned_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_topics_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 64)))
);


ALTER TABLE public.conversation_topics OWNER TO hub;

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_secret boolean DEFAULT false NOT NULL,
    pinned_message_id uuid,
    is_saved boolean DEFAULT false NOT NULL,
    disappear_hours integer,
    disappear_after_read boolean DEFAULT false NOT NULL,
    is_group boolean DEFAULT false NOT NULL,
    title text,
    avatar_url text,
    created_by uuid,
    perm_send text DEFAULT 'all'::text NOT NULL,
    perm_add text DEFAULT 'all'::text NOT NULL,
    perm_info text DEFAULT 'admins'::text NOT NULL,
    perm_pin text DEFAULT 'all'::text NOT NULL,
    topics_enabled boolean DEFAULT false NOT NULL,
    secret_initiator uuid,
    secret_initiator_device uuid,
    secret_peer_device uuid,
    secret_init jsonb,
    secret_ttl_seconds integer DEFAULT 0 NOT NULL,
    CONSTRAINT conversations_perms_check CHECK (((perm_send = ANY (ARRAY['all'::text, 'admins'::text])) AND (perm_add = ANY (ARRAY['all'::text, 'admins'::text])) AND (perm_info = ANY (ARRAY['all'::text, 'admins'::text])) AND (perm_pin = ANY (ARRAY['all'::text, 'admins'::text]))))
);


ALTER TABLE public.conversations OWNER TO hub;

--
-- Name: dm_call_signals; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.dm_call_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consumed_at timestamp with time zone,
    call_id uuid
);


ALTER TABLE public.dm_call_signals OWNER TO hub;

--
-- Name: dm_calls; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.dm_calls (
    conversation_id uuid NOT NULL,
    caller_id uuid NOT NULL,
    callee_id uuid NOT NULL,
    status text DEFAULT 'ringing'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


ALTER TABLE public.dm_calls OWNER TO hub;

--
-- Name: e2e_devices; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.e2e_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    identity_dh text NOT NULL,
    identity_sign text NOT NULL,
    spk_id integer NOT NULL,
    spk_pub text NOT NULL,
    spk_sig text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


ALTER TABLE public.e2e_devices OWNER TO hub;

--
-- Name: e2e_prekeys; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.e2e_prekeys (
    device_id uuid NOT NULL,
    key_id integer NOT NULL,
    pub text NOT NULL
);


ALTER TABLE public.e2e_prekeys OWNER TO hub;

--
-- Name: email_verify_codes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.email_verify_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.email_verify_codes OWNER TO hub;

--
-- Name: follow_requests; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.follow_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follow_requests_check CHECK ((from_user_id <> to_user_id)),
    CONSTRAINT follow_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'denied'::text])))
);


ALTER TABLE public.follow_requests OWNER TO hub;

--
-- Name: follows; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.follows (
    follower_id uuid NOT NULL,
    followee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follows_check CHECK ((follower_id <> followee_id))
);


ALTER TABLE public.follows OWNER TO hub;

--
-- Name: group_invite_links; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.group_invite_links (
    token text NOT NULL,
    conversation_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    max_uses integer,
    uses integer DEFAULT 0 NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT group_invite_links_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0)))
);


ALTER TABLE public.group_invite_links OWNER TO hub;

--
-- Name: guest_links; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.guest_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    created_by uuid NOT NULL,
    label text DEFAULT 'Семья'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    revoked_at timestamp with time zone
);


ALTER TABLE public.guest_links OWNER TO hub;

--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.invite_codes (
    code text NOT NULL,
    max_uses integer DEFAULT 1 NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_user_id uuid,
    CONSTRAINT invite_codes_max_uses_chk CHECK ((max_uses > 0)),
    CONSTRAINT invite_codes_uses_chk CHECK ((uses >= 0))
);


ALTER TABLE public.invite_codes OWNER TO hub;

--
-- Name: link_previews; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.link_previews (
    url text NOT NULL,
    ok boolean DEFAULT false NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    site_name text DEFAULT ''::text NOT NULL,
    final_url text DEFAULT ''::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.link_previews OWNER TO hub;

--
-- Name: live_streams; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.live_streams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    channel_id uuid,
    host_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    video boolean DEFAULT true NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    peak_viewers integer DEFAULT 0 NOT NULL,
    CONSTRAINT live_streams_check CHECK ((num_nonnulls(conversation_id, channel_id) = 1)),
    CONSTRAINT live_streams_title_check CHECK ((char_length(title) <= 80))
);


ALTER TABLE public.live_streams OWNER TO hub;

--
-- Name: market_ads; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.market_ads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    city text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'Разное'::text NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    lat double precision,
    lng double precision
);


ALTER TABLE public.market_ads OWNER TO hub;

--
-- Name: media; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    content_type text NOT NULL,
    bytes bigint NOT NULL,
    storage_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    filename text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.media OWNER TO hub;

--
-- Name: media_uploads; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.media_uploads (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    s3_key text NOT NULL,
    upload_id text NOT NULL,
    content_type text NOT NULL,
    filename text DEFAULT ''::text NOT NULL,
    size bigint NOT NULL,
    part_size bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    aborted_at timestamp with time zone
);


ALTER TABLE public.media_uploads OWNER TO hub;

--
-- Name: meetup_rsvps; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.meetup_rsvps (
    meetup_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'going'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meetup_rsvps_status_check CHECK ((status = ANY (ARRAY['going'::text, 'maybe'::text, 'cancelled'::text])))
);


ALTER TABLE public.meetup_rsvps OWNER TO hub;

--
-- Name: meetups; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.meetups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    city text DEFAULT ''::text NOT NULL,
    place text DEFAULT ''::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    conversation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    lat double precision,
    lng double precision
);


ALTER TABLE public.meetups OWNER TO hub;

--
-- Name: mentions; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mentioned_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    post_id uuid,
    message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mentions_check CHECK (((post_id IS NOT NULL) OR (message_id IS NOT NULL)))
);


ALTER TABLE public.mentions OWNER TO hub;

--
-- Name: message_edits; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.message_edits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    body text NOT NULL,
    edited_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_edits OWNER TO hub;

--
-- Name: message_hidden; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.message_hidden (
    user_id uuid NOT NULL,
    message_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_hidden OWNER TO hub;

--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.message_reactions (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16)))
);


ALTER TABLE public.message_reactions OWNER TO hub;

--
-- Name: message_transcripts; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.message_transcripts (
    message_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    requested_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_transcripts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])))
);


ALTER TABLE public.message_transcripts OWNER TO hub;

--
-- Name: message_translations; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.message_translations (
    message_id uuid NOT NULL,
    target_lang text NOT NULL,
    body_hash text NOT NULL,
    text text NOT NULL,
    source_lang text DEFAULT ''::text NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.message_translations OWNER TO hub;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    media_url text DEFAULT ''::text NOT NULL,
    edited_at timestamp with time zone,
    msg_type text DEFAULT 'text'::text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    reply_to_id uuid,
    forward_of uuid,
    expires_at timestamp with time zone,
    read_at timestamp with time zone,
    story_id uuid,
    story_quote jsonb,
    call_meta jsonb,
    meta jsonb,
    topic_id uuid,
    e2e jsonb,
    ttl_seconds integer,
    CONSTRAINT messages_msg_type_check CHECK ((msg_type = ANY (ARRAY['text'::text, 'voice'::text, 'image'::text, 'video_note'::text, 'video'::text, 'file'::text, 'call'::text, 'sticker'::text, 'gif'::text, 'poll'::text, 'location'::text, 'contact'::text, 'e2e'::text])))
);


ALTER TABLE public.messages OWNER TO hub;

--
-- Name: mutes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.mutes (
    muter_id uuid NOT NULL,
    muted_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mutes_check CHECK ((muter_id <> muted_id))
);


ALTER TABLE public.mutes OWNER TO hub;

--
-- Name: notification_prefs; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.notification_prefs (
    user_id uuid NOT NULL,
    likes boolean DEFAULT true NOT NULL,
    comments boolean DEFAULT true NOT NULL,
    follows boolean DEFAULT true NOT NULL,
    messages boolean DEFAULT true NOT NULL,
    mentions boolean DEFAULT true NOT NULL,
    digest_hours integer DEFAULT 0 NOT NULL,
    quiet_start integer,
    quiet_end integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quiet_allow_favorites boolean DEFAULT true NOT NULL,
    paused boolean DEFAULT false NOT NULL,
    CONSTRAINT notification_prefs_digest_hours_check CHECK (((digest_hours >= 0) AND (digest_hours <= 168))),
    CONSTRAINT notification_prefs_quiet_end_check CHECK (((quiet_end IS NULL) OR ((quiet_end >= 0) AND (quiet_end <= 23)))),
    CONSTRAINT notification_prefs_quiet_start_check CHECK (((quiet_start IS NULL) OR ((quiet_start >= 0) AND (quiet_start <= 23))))
);


ALTER TABLE public.notification_prefs OWNER TO hub;

--
-- Name: password_reset_codes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.password_reset_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contact text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.password_reset_codes OWNER TO hub;

--
-- Name: poll_options; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.poll_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poll_id uuid NOT NULL,
    label text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT poll_options_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 80)))
);


ALTER TABLE public.poll_options OWNER TO hub;

--
-- Name: poll_votes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.poll_votes (
    poll_id uuid NOT NULL,
    option_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.poll_votes OWNER TO hub;

--
-- Name: polls; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.polls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid,
    channel_post_id uuid,
    question text NOT NULL,
    multi boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT polls_check CHECK ((((post_id IS NOT NULL) AND (channel_post_id IS NULL)) OR ((post_id IS NULL) AND (channel_post_id IS NOT NULL))))
);


ALTER TABLE public.polls OWNER TO hub;

--
-- Name: post_bookmarks; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.post_bookmarks (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    folder_id uuid
);


ALTER TABLE public.post_bookmarks OWNER TO hub;

--
-- Name: post_images; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.post_images (
    post_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    url text NOT NULL,
    CONSTRAINT post_images_position_check CHECK ((("position" >= 0) AND ("position" < 10)))
);


ALTER TABLE public.post_images OWNER TO hub;

--
-- Name: post_likes; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.post_likes (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.post_likes OWNER TO hub;

--
-- Name: post_reposts; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.post_reposts (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    quote_text text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.post_reposts OWNER TO hub;

--
-- Name: post_views; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.post_views (
    post_id uuid NOT NULL,
    viewer_id uuid,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.post_views OWNER TO hub;

--
-- Name: posts; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    image_url text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    repost_of uuid,
    status text DEFAULT 'published'::text NOT NULL,
    scheduled_at timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    attention_count integer DEFAULT 0 NOT NULL,
    age_rating text DEFAULT 'all'::text NOT NULL,
    CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text])))
);


ALTER TABLE public.posts OWNER TO hub;

--
-- Name: profile_widgets; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.profile_widgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profile_widgets_kind_check CHECK ((kind = ANY (ARRAY['price_list'::text, 'portfolio'::text])))
);


ALTER TABLE public.profile_widgets OWNER TO hub;

--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.push_subscriptions OWNER TO hub;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    device_name text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO hub;

--
-- Name: reports; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid NOT NULL,
    post_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_user_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    CONSTRAINT reports_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text, 'actioned'::text]))),
    CONSTRAINT reports_target_chk CHECK (((post_id IS NOT NULL) OR (reported_user_id IS NOT NULL)))
);


ALTER TABLE public.reports OWNER TO hub;

--
-- Name: scheduled_dms; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.scheduled_dms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    media_url text DEFAULT ''::text NOT NULL,
    msg_type text DEFAULT 'text'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    cancelled_at timestamp with time zone
);


ALTER TABLE public.scheduled_dms OWNER TO hub;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO hub;

--
-- Name: seller_reviews; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.seller_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    rating integer NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.seller_reviews OWNER TO hub;

--
-- Name: stories; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    media_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    deleted_at timestamp with time zone,
    audience text DEFAULT 'all'::text NOT NULL,
    filter_id text DEFAULT ''::text NOT NULL,
    place_name text DEFAULT ''::text NOT NULL,
    media_kind text DEFAULT ''::text NOT NULL,
    CONSTRAINT stories_audience_check CHECK ((audience = ANY (ARRAY['all'::text, 'close_friends'::text])))
);


ALTER TABLE public.stories OWNER TO hub;

--
-- Name: story_reactions; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.story_reactions (
    story_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.story_reactions OWNER TO hub;

--
-- Name: story_views; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.story_views (
    story_id uuid NOT NULL,
    viewer_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.story_views OWNER TO hub;

--
-- Name: user_archive; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.user_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    item_type text NOT NULL,
    ref_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    preview text DEFAULT ''::text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_archive_item_type_check CHECK ((item_type = ANY (ARRAY['post'::text, 'message'::text, 'contact'::text, 'listing'::text, 'photo'::text, 'video'::text])))
);


ALTER TABLE public.user_archive OWNER TO hub;

--
-- Name: user_chat_prefs; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.user_chat_prefs (
    user_id uuid NOT NULL,
    theme_id text DEFAULT 'default'::text NOT NULL,
    appearance text DEFAULT 'dark'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_chat_prefs_appearance_check CHECK ((appearance = ANY (ARRAY['dark'::text, 'light'::text, 'system'::text])))
);


ALTER TABLE public.user_chat_prefs OWNER TO hub;

--
-- Name: users; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    phone text,
    username text NOT NULL,
    password_hash text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    bio text DEFAULT ''::text NOT NULL,
    avatar_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    consent_v1_at timestamp with time zone,
    consent_152_at timestamp with time zone,
    role text DEFAULT 'user'::text NOT NULL,
    birth_date date,
    gender text,
    city text,
    is_private boolean DEFAULT false NOT NULL,
    about text DEFAULT ''::text NOT NULL,
    services text DEFAULT ''::text NOT NULL,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    show_city boolean DEFAULT true NOT NULL,
    show_birth_date boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    presence_status text DEFAULT 'available'::text NOT NULL,
    presence_text text DEFAULT ''::text NOT NULL,
    attention_count integer DEFAULT 0 NOT NULL,
    last_lat double precision,
    last_lng double precision,
    geo_consent_at timestamp with time zone,
    phone_hash text,
    country text,
    show_gender boolean DEFAULT false NOT NULL,
    show_country boolean DEFAULT true NOT NULL,
    show_contact boolean DEFAULT false NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    phone_verified boolean DEFAULT false NOT NULL,
    purged_at timestamp with time zone,
    show_adult boolean DEFAULT false NOT NULL,
    parental_enabled boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    is_bot boolean DEFAULT false NOT NULL,
    CONSTRAINT users_country_check CHECK (((country IS NULL) OR (country = ANY (ARRAY['RU'::text, 'BY'::text])))),
    CONSTRAINT users_gender_check CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['male'::text, 'female'::text])))),
    CONSTRAINT users_role_chk CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
);


ALTER TABLE public.users OWNER TO hub;

--
-- Name: voice_room_members; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.voice_room_members (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    muted boolean DEFAULT true NOT NULL,
    role text DEFAULT 'listener'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_room_members_role_check CHECK ((role = ANY (ARRAY['host'::text, 'speaker'::text, 'listener'::text])))
);


ALTER TABLE public.voice_room_members OWNER TO hub;

--
-- Name: voice_room_signals; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.voice_room_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT voice_room_signals_kind_check CHECK ((kind = ANY (ARRAY['offer'::text, 'answer'::text, 'ice'::text])))
);


ALTER TABLE public.voice_room_signals OWNER TO hub;

--
-- Name: voice_rooms; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.voice_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_id uuid NOT NULL,
    title text NOT NULL,
    topic text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone
);


ALTER TABLE public.voice_rooms OWNER TO hub;

--
-- Name: waitlist_emails; Type: TABLE; Schema: public; Owner: hub
--

CREATE TABLE public.waitlist_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text
);


ALTER TABLE public.waitlist_emails OWNER TO hub;

--
-- Name: bot_updates id; Type: DEFAULT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_updates ALTER COLUMN id SET DEFAULT nextval('public.bot_updates_id_seq'::regclass);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: attention_gifts attention_gifts_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.attention_gifts
    ADD CONSTRAINT attention_gifts_pkey PRIMARY KEY (id);


--
-- Name: blocks blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: bookmark_folders bookmark_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bookmark_folders
    ADD CONSTRAINT bookmark_folders_pkey PRIMARY KEY (id);


--
-- Name: bookmark_folders bookmark_folders_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bookmark_folders
    ADD CONSTRAINT bookmark_folders_user_id_name_key UNIQUE (user_id, name);


--
-- Name: bot_callbacks bot_callbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_callbacks
    ADD CONSTRAINT bot_callbacks_pkey PRIMARY KEY (id);


--
-- Name: bot_updates bot_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_updates
    ADD CONSTRAINT bot_updates_pkey PRIMARY KEY (id);


--
-- Name: bots bots_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_pkey PRIMARY KEY (user_id);


--
-- Name: bots bots_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_token_hash_key UNIQUE (token_hash);


--
-- Name: call_participants call_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.call_participants
    ADD CONSTRAINT call_participants_pkey PRIMARY KEY (call_id, user_id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: channel_members channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: channel_post_comments channel_post_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_comments
    ADD CONSTRAINT channel_post_comments_pkey PRIMARY KEY (id);


--
-- Name: channel_post_reactions channel_post_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_reactions
    ADD CONSTRAINT channel_post_reactions_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: channel_post_views channel_post_views_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_views
    ADD CONSTRAINT channel_post_views_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: channel_posts channel_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_posts
    ADD CONSTRAINT channel_posts_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channels channels_slug_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_slug_key UNIQUE (slug);


--
-- Name: chat_poll_votes chat_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT chat_poll_votes_pkey PRIMARY KEY (message_id, user_id, option_idx);


--
-- Name: chat_polls chat_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT chat_polls_pkey PRIMARY KEY (message_id);


--
-- Name: clip_likes clip_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.clip_likes
    ADD CONSTRAINT clip_likes_pkey PRIMARY KEY (clip_id, user_id);


--
-- Name: clips clips_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_pkey PRIMARY KEY (id);


--
-- Name: close_friends close_friends_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.close_friends
    ADD CONSTRAINT close_friends_pkey PRIMARY KEY (owner_id, friend_id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: conversation_invites conversation_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_invites
    ADD CONSTRAINT conversation_invites_pkey PRIMARY KEY (conversation_id, user_id);


--
-- Name: conversation_members conversation_members_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (conversation_id, user_id);


--
-- Name: conversation_mutes conversation_mutes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_mutes
    ADD CONSTRAINT conversation_mutes_pkey PRIMARY KEY (user_id, conversation_id);


--
-- Name: conversation_read_log conversation_read_log_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_read_log
    ADD CONSTRAINT conversation_read_log_pkey PRIMARY KEY (conversation_id, user_id, read_at);


--
-- Name: conversation_topic_mutes conversation_topic_mutes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_mutes
    ADD CONSTRAINT conversation_topic_mutes_pkey PRIMARY KEY (topic_id, user_id);


--
-- Name: conversation_topic_reads conversation_topic_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_reads
    ADD CONSTRAINT conversation_topic_reads_pkey PRIMARY KEY (topic_id, user_id);


--
-- Name: conversation_topics conversation_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topics
    ADD CONSTRAINT conversation_topics_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: dm_call_signals dm_call_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_call_signals
    ADD CONSTRAINT dm_call_signals_pkey PRIMARY KEY (id);


--
-- Name: dm_calls dm_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_calls
    ADD CONSTRAINT dm_calls_pkey PRIMARY KEY (conversation_id);


--
-- Name: e2e_devices e2e_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.e2e_devices
    ADD CONSTRAINT e2e_devices_pkey PRIMARY KEY (id);


--
-- Name: e2e_prekeys e2e_prekeys_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.e2e_prekeys
    ADD CONSTRAINT e2e_prekeys_pkey PRIMARY KEY (device_id, key_id);


--
-- Name: email_verify_codes email_verify_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.email_verify_codes
    ADD CONSTRAINT email_verify_codes_pkey PRIMARY KEY (id);


--
-- Name: follow_requests follow_requests_from_user_id_to_user_id_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follow_requests
    ADD CONSTRAINT follow_requests_from_user_id_to_user_id_key UNIQUE (from_user_id, to_user_id);


--
-- Name: follow_requests follow_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follow_requests
    ADD CONSTRAINT follow_requests_pkey PRIMARY KEY (id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followee_id);


--
-- Name: group_invite_links group_invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_pkey PRIMARY KEY (token);


--
-- Name: guest_links guest_links_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_pkey PRIMARY KEY (id);


--
-- Name: guest_links guest_links_token_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_token_key UNIQUE (token);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (code);


--
-- Name: link_previews link_previews_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.link_previews
    ADD CONSTRAINT link_previews_pkey PRIMARY KEY (url);


--
-- Name: live_streams live_streams_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.live_streams
    ADD CONSTRAINT live_streams_pkey PRIMARY KEY (id);


--
-- Name: market_ads market_ads_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.market_ads
    ADD CONSTRAINT market_ads_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: media media_storage_name_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_storage_name_key UNIQUE (storage_name);


--
-- Name: media_uploads media_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.media_uploads
    ADD CONSTRAINT media_uploads_pkey PRIMARY KEY (id);


--
-- Name: meetup_rsvps meetup_rsvps_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetup_rsvps
    ADD CONSTRAINT meetup_rsvps_pkey PRIMARY KEY (meetup_id, user_id);


--
-- Name: meetups meetups_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetups
    ADD CONSTRAINT meetups_pkey PRIMARY KEY (id);


--
-- Name: mentions mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_pkey PRIMARY KEY (id);


--
-- Name: message_edits message_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_edits
    ADD CONSTRAINT message_edits_pkey PRIMARY KEY (id);


--
-- Name: message_hidden message_hidden_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_hidden
    ADD CONSTRAINT message_hidden_pkey PRIMARY KEY (user_id, message_id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);


--
-- Name: message_transcripts message_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_transcripts
    ADD CONSTRAINT message_transcripts_pkey PRIMARY KEY (message_id);


--
-- Name: message_translations message_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_translations
    ADD CONSTRAINT message_translations_pkey PRIMARY KEY (message_id, target_lang, body_hash);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: mutes mutes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mutes
    ADD CONSTRAINT mutes_pkey PRIMARY KEY (muter_id, muted_id);


--
-- Name: notification_prefs notification_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id);


--
-- Name: password_reset_codes password_reset_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.password_reset_codes
    ADD CONSTRAINT password_reset_codes_pkey PRIMARY KEY (id);


--
-- Name: poll_options poll_options_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_options
    ADD CONSTRAINT poll_options_pkey PRIMARY KEY (id);


--
-- Name: poll_votes poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (poll_id, user_id, option_id);


--
-- Name: polls polls_channel_post_id_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_channel_post_id_key UNIQUE (channel_post_id);


--
-- Name: polls polls_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_pkey PRIMARY KEY (id);


--
-- Name: polls polls_post_id_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_post_id_key UNIQUE (post_id);


--
-- Name: post_bookmarks post_bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_bookmarks
    ADD CONSTRAINT post_bookmarks_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: post_images post_images_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_pkey PRIMARY KEY (post_id, "position");


--
-- Name: post_likes post_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: post_reposts post_reposts_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_reposts
    ADD CONSTRAINT post_reposts_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: profile_widgets profile_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.profile_widgets
    ADD CONSTRAINT profile_widgets_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_uidx; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_uidx UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: scheduled_dms scheduled_dms_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.scheduled_dms
    ADD CONSTRAINT scheduled_dms_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: seller_reviews seller_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.seller_reviews
    ADD CONSTRAINT seller_reviews_pkey PRIMARY KEY (id);


--
-- Name: seller_reviews seller_reviews_seller_id_reviewer_id_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.seller_reviews
    ADD CONSTRAINT seller_reviews_seller_id_reviewer_id_key UNIQUE (seller_id, reviewer_id);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: story_reactions story_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_pkey PRIMARY KEY (story_id, user_id);


--
-- Name: story_views story_views_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_pkey PRIMARY KEY (story_id, viewer_id);


--
-- Name: user_archive user_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.user_archive
    ADD CONSTRAINT user_archive_pkey PRIMARY KEY (id);


--
-- Name: user_archive user_archive_user_id_item_type_ref_id_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.user_archive
    ADD CONSTRAINT user_archive_user_id_item_type_ref_id_key UNIQUE (user_id, item_type, ref_id);


--
-- Name: user_chat_prefs user_chat_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.user_chat_prefs
    ADD CONSTRAINT user_chat_prefs_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: voice_room_members voice_room_members_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_members
    ADD CONSTRAINT voice_room_members_pkey PRIMARY KEY (room_id, user_id);


--
-- Name: voice_room_signals voice_room_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_signals
    ADD CONSTRAINT voice_room_signals_pkey PRIMARY KEY (id);


--
-- Name: voice_rooms voice_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_rooms
    ADD CONSTRAINT voice_rooms_pkey PRIMARY KEY (id);


--
-- Name: waitlist_emails waitlist_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.waitlist_emails
    ADD CONSTRAINT waitlist_emails_pkey PRIMARY KEY (id);


--
-- Name: idx_activities_user_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_activities_user_created ON public.activities USING btree (user_id, created_at DESC, id DESC);


--
-- Name: idx_activities_user_unread; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_activities_user_unread ON public.activities USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_attention_gifts_once_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX idx_attention_gifts_once_post ON public.attention_gifts USING btree (from_user_id, post_id) WHERE (post_id IS NOT NULL);


--
-- Name: idx_attention_gifts_once_profile; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX idx_attention_gifts_once_profile ON public.attention_gifts USING btree (from_user_id, to_user_id) WHERE (post_id IS NULL);


--
-- Name: idx_blocks_blocked; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_blocks_blocked ON public.blocks USING btree (blocked_id);


--
-- Name: idx_bot_callbacks_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_bot_callbacks_created ON public.bot_callbacks USING btree (created_at);


--
-- Name: idx_bot_updates_pending; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_bot_updates_pending ON public.bot_updates USING btree (bot_id, id) WHERE (delivered_at IS NULL);


--
-- Name: idx_bots_owner; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_bots_owner ON public.bots USING btree (owner_id);


--
-- Name: idx_call_participants_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_call_participants_user ON public.call_participants USING btree (user_id, state);


--
-- Name: idx_calls_live; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_calls_live ON public.calls USING btree (status, created_at) WHERE (status = ANY (ARRAY['ringing'::text, 'active'::text]));


--
-- Name: idx_channel_join_log_user_time; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_channel_join_log_user_time ON public.channel_join_log USING btree (user_id, joined_at DESC);


--
-- Name: idx_channel_members_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_channel_members_user ON public.channel_members USING btree (user_id);


--
-- Name: idx_channel_posts_channel; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_channel_posts_channel ON public.channel_posts USING btree (channel_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_channels_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_channels_created ON public.channels USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_clip_likes_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_clip_likes_user ON public.clip_likes USING btree (user_id, created_at DESC);


--
-- Name: idx_clips_author; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_clips_author ON public.clips USING btree (author_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_clips_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_clips_created ON public.clips USING btree (created_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_close_friends_friend; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_close_friends_friend ON public.close_friends USING btree (friend_id);


--
-- Name: idx_comments_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_comments_post ON public.comments USING btree (post_id, created_at);


--
-- Name: idx_conversation_invites_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_conversation_invites_user ON public.conversation_invites USING btree (user_id);


--
-- Name: idx_conversation_members_conv_joined; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_conversation_members_conv_joined ON public.conversation_members USING btree (conversation_id, joined_at);


--
-- Name: idx_conversation_members_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_conversation_members_user ON public.conversation_members USING btree (user_id);


--
-- Name: idx_conversation_topic_mutes_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_conversation_topic_mutes_user ON public.conversation_topic_mutes USING btree (user_id);


--
-- Name: idx_conversation_topics_conv; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_conversation_topics_conv ON public.conversation_topics USING btree (conversation_id);


--
-- Name: idx_cpc_author_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_cpc_author_created ON public.channel_post_comments USING btree (author_id, created_at);


--
-- Name: idx_cpc_post_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_cpc_post_created ON public.channel_post_comments USING btree (post_id, created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_dm_call_signals_inbox; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_dm_call_signals_inbox ON public.dm_call_signals USING btree (conversation_id, to_user_id, created_at) WHERE (consumed_at IS NULL);


--
-- Name: idx_e2e_devices_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_e2e_devices_user ON public.e2e_devices USING btree (user_id, last_seen_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: idx_email_verify_user_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_email_verify_user_created ON public.email_verify_codes USING btree (user_id, created_at DESC);


--
-- Name: idx_follow_requests_from; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_follow_requests_from ON public.follow_requests USING btree (from_user_id, status);


--
-- Name: idx_follow_requests_to_pending; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_follow_requests_to_pending ON public.follow_requests USING btree (to_user_id, created_at DESC) WHERE (status = 'pending'::text);


--
-- Name: idx_follows_followee; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_follows_followee ON public.follows USING btree (followee_id);


--
-- Name: idx_group_invite_links_conv; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_group_invite_links_conv ON public.group_invite_links USING btree (conversation_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_guest_links_token; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_guest_links_token ON public.guest_links USING btree (token) WHERE (revoked_at IS NULL);


--
-- Name: idx_market_ads_city; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_market_ads_city ON public.market_ads USING btree (lower(city)) WHERE (deleted_at IS NULL);


--
-- Name: idx_market_ads_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_market_ads_created ON public.market_ads USING btree (created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_media_uploads_open; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_media_uploads_open ON public.media_uploads USING btree (created_at) WHERE ((completed_at IS NULL) AND (aborted_at IS NULL));


--
-- Name: idx_media_user_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_media_user_created ON public.media USING btree (user_id, created_at DESC);


--
-- Name: idx_meetups_starts; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_meetups_starts ON public.meetups USING btree (starts_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_mentions_mentioned_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_mentions_mentioned_created ON public.mentions USING btree (mentioned_id, created_at DESC);


--
-- Name: idx_mentions_message; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_mentions_message ON public.mentions USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_mentions_message_mentioned; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_mentions_message_mentioned ON public.mentions USING btree (message_id, mentioned_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_mentions_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_mentions_post ON public.mentions USING btree (post_id) WHERE (post_id IS NOT NULL);


--
-- Name: idx_message_edits_msg_time; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_message_edits_msg_time ON public.message_edits USING btree (message_id, edited_at DESC);


--
-- Name: idx_message_hidden_msg; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_message_hidden_msg ON public.message_hidden USING btree (message_id);


--
-- Name: idx_message_reactions_msg; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_message_reactions_msg ON public.message_reactions USING btree (message_id);


--
-- Name: idx_messages_body_fts; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_messages_body_fts ON public.messages USING gin (to_tsvector('russian'::regconfig, COALESCE(body, ''::text))) WHERE (deleted_at IS NULL);


--
-- Name: idx_messages_body_trgm; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_messages_body_trgm ON public.messages USING gin (body public.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_messages_conv_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_messages_conv_created ON public.messages USING btree (conversation_id, created_at DESC, id DESC);


--
-- Name: idx_messages_expires; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_messages_expires ON public.messages USING btree (expires_at) WHERE ((deleted_at IS NULL) AND (expires_at IS NOT NULL));


--
-- Name: idx_messages_topic_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_messages_topic_created ON public.messages USING btree (topic_id, created_at DESC) WHERE (topic_id IS NOT NULL);


--
-- Name: idx_mutes_muted; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_mutes_muted ON public.mutes USING btree (muted_id);


--
-- Name: idx_password_reset_contact_active; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_password_reset_contact_active ON public.password_reset_codes USING btree (contact, expires_at) WHERE (used_at IS NULL);


--
-- Name: idx_password_reset_user_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_password_reset_user_created ON public.password_reset_codes USING btree (user_id, created_at DESC);


--
-- Name: idx_poll_options_poll; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_poll_options_poll ON public.poll_options USING btree (poll_id, "position");


--
-- Name: idx_poll_votes_option; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_poll_votes_option ON public.poll_votes USING btree (option_id);


--
-- Name: idx_post_bookmarks_folder; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_post_bookmarks_folder ON public.post_bookmarks USING btree (user_id, folder_id, created_at DESC);


--
-- Name: idx_post_bookmarks_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_post_bookmarks_user ON public.post_bookmarks USING btree (user_id, created_at DESC);


--
-- Name: idx_post_reposts_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_post_reposts_post ON public.post_reposts USING btree (post_id);


--
-- Name: idx_post_reposts_user_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_post_reposts_user_created ON public.post_reposts USING btree (user_id, created_at DESC);


--
-- Name: idx_post_views_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_post_views_post ON public.post_views USING btree (post_id, viewed_at DESC);


--
-- Name: idx_post_views_unique_viewer; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX idx_post_views_unique_viewer ON public.post_views USING btree (post_id, viewer_id) WHERE (viewer_id IS NOT NULL);


--
-- Name: idx_posts_author_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_author_created ON public.posts USING btree (author_id, created_at DESC);


--
-- Name: idx_posts_author_status; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_author_status ON public.posts USING btree (author_id, status, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_posts_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_created ON public.posts USING btree (created_at DESC, id DESC);


--
-- Name: idx_posts_repost_of; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_repost_of ON public.posts USING btree (repost_of) WHERE (repost_of IS NOT NULL);


--
-- Name: idx_posts_scheduled; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_scheduled ON public.posts USING btree (scheduled_at) WHERE ((status = 'scheduled'::text) AND (deleted_at IS NULL));


--
-- Name: idx_posts_tags; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_posts_tags ON public.posts USING gin (tags);


--
-- Name: idx_profile_widgets_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_profile_widgets_user ON public.profile_widgets USING btree (user_id, sort_order, created_at);


--
-- Name: idx_push_subscriptions_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions USING btree (user_id, created_at DESC);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_refresh_tokens_user_active; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_refresh_tokens_user_active ON public.refresh_tokens USING btree (user_id, created_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: idx_reports_post; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_reports_post ON public.reports USING btree (post_id, created_at DESC);


--
-- Name: idx_reports_reported_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_reports_reported_user ON public.reports USING btree (reported_user_id, created_at DESC);


--
-- Name: idx_reports_reporter; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_reports_reporter ON public.reports USING btree (reporter_id, created_at DESC);


--
-- Name: idx_reports_status_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_reports_status_created ON public.reports USING btree (status, created_at DESC);


--
-- Name: idx_scheduled_dms_due; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_scheduled_dms_due ON public.scheduled_dms USING btree (scheduled_at) WHERE ((sent_at IS NULL) AND (cancelled_at IS NULL));


--
-- Name: idx_seller_reviews_seller; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_seller_reviews_seller ON public.seller_reviews USING btree (seller_id, created_at DESC);


--
-- Name: idx_stories_author_created; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_stories_author_created ON public.stories USING btree (author_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_stories_expires; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_stories_expires ON public.stories USING btree (expires_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_transcripts_queue; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_transcripts_queue ON public.message_transcripts USING btree (created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_users_city; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_city ON public.users USING btree (city) WHERE ((city IS NOT NULL) AND (city <> ''::text) AND (deleted_at IS NULL));


--
-- Name: idx_users_country; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_country ON public.users USING btree (country) WHERE ((country IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_users_display_name_lower; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_display_name_lower ON public.users USING btree (lower(display_name)) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_last_seen_at; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_last_seen_at ON public.users USING btree (last_seen_at DESC NULLS LAST) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_phone_hash; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_phone_hash ON public.users USING btree (phone_hash) WHERE ((phone_hash IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_users_username_lower; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_users_username_lower ON public.users USING btree (lower(username)) WHERE (deleted_at IS NULL);


--
-- Name: idx_voice_room_members_user; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_voice_room_members_user ON public.voice_room_members USING btree (user_id);


--
-- Name: idx_voice_rooms_open; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_voice_rooms_open ON public.voice_rooms USING btree (created_at DESC) WHERE (closed_at IS NULL);


--
-- Name: idx_voice_rooms_topic_open; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_voice_rooms_topic_open ON public.voice_rooms USING btree (topic, created_at DESC) WHERE ((closed_at IS NULL) AND (topic <> ''::text));


--
-- Name: idx_voice_signals_inbox; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX idx_voice_signals_inbox ON public.voice_room_signals USING btree (room_id, to_user_id, created_at) WHERE (consumed_at IS NULL);


--
-- Name: invite_codes_owner_uidx; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX invite_codes_owner_uidx ON public.invite_codes USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);


--
-- Name: live_streams_one_active_chan; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX live_streams_one_active_chan ON public.live_streams USING btree (channel_id) WHERE ((ended_at IS NULL) AND (channel_id IS NOT NULL));


--
-- Name: live_streams_one_active_conv; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX live_streams_one_active_conv ON public.live_streams USING btree (conversation_id) WHERE ((ended_at IS NULL) AND (conversation_id IS NOT NULL));


--
-- Name: live_streams_started; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX live_streams_started ON public.live_streams USING btree (started_at DESC);


--
-- Name: uq_calls_live_conv; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX uq_calls_live_conv ON public.calls USING btree (conversation_id) WHERE (status = ANY (ARRAY['ringing'::text, 'active'::text]));


--
-- Name: uq_conversation_members_owner; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX uq_conversation_members_owner ON public.conversation_members USING btree (conversation_id) WHERE (role = 'owner'::text);


--
-- Name: uq_conversation_topics_general; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX uq_conversation_topics_general ON public.conversation_topics USING btree (conversation_id) WHERE is_general;


--
-- Name: user_archive_user_created_idx; Type: INDEX; Schema: public; Owner: hub
--

CREATE INDEX user_archive_user_created_idx ON public.user_archive USING btree (user_id, created_at DESC);


--
-- Name: waitlist_emails_email_lower_uidx; Type: INDEX; Schema: public; Owner: hub
--

CREATE UNIQUE INDEX waitlist_emails_email_lower_uidx ON public.waitlist_emails USING btree (lower(email));


--
-- Name: activities activities_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activities activities_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: attention_gifts attention_gifts_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.attention_gifts
    ADD CONSTRAINT attention_gifts_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: attention_gifts attention_gifts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.attention_gifts
    ADD CONSTRAINT attention_gifts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: attention_gifts attention_gifts_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.attention_gifts
    ADD CONSTRAINT attention_gifts_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: blocks blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bookmark_folders bookmark_folders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bookmark_folders
    ADD CONSTRAINT bookmark_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bot_callbacks bot_callbacks_bot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_callbacks
    ADD CONSTRAINT bot_callbacks_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.bots(user_id) ON DELETE CASCADE;


--
-- Name: bot_callbacks bot_callbacks_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_callbacks
    ADD CONSTRAINT bot_callbacks_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: bot_callbacks bot_callbacks_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_callbacks
    ADD CONSTRAINT bot_callbacks_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: bot_callbacks bot_callbacks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_callbacks
    ADD CONSTRAINT bot_callbacks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bot_updates bot_updates_bot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bot_updates
    ADD CONSTRAINT bot_updates_bot_id_fkey FOREIGN KEY (bot_id) REFERENCES public.bots(user_id) ON DELETE CASCADE;


--
-- Name: bots bots_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bots bots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: call_participants call_participants_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.call_participants
    ADD CONSTRAINT call_participants_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE CASCADE;


--
-- Name: call_participants call_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.call_participants
    ADD CONSTRAINT call_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: calls calls_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: calls calls_initiator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_join_log channel_join_log_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_join_log
    ADD CONSTRAINT channel_join_log_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_join_log channel_join_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_join_log
    ADD CONSTRAINT channel_join_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_members channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_members channel_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_post_comments channel_post_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_comments
    ADD CONSTRAINT channel_post_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_post_comments channel_post_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_comments
    ADD CONSTRAINT channel_post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.channel_posts(id) ON DELETE CASCADE;


--
-- Name: channel_post_comments channel_post_comments_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_comments
    ADD CONSTRAINT channel_post_comments_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.channel_post_comments(id) ON DELETE SET NULL;


--
-- Name: channel_post_reactions channel_post_reactions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_reactions
    ADD CONSTRAINT channel_post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.channel_posts(id) ON DELETE CASCADE;


--
-- Name: channel_post_reactions channel_post_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_reactions
    ADD CONSTRAINT channel_post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_post_views channel_post_views_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_views
    ADD CONSTRAINT channel_post_views_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.channel_posts(id) ON DELETE CASCADE;


--
-- Name: channel_post_views channel_post_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_post_views
    ADD CONSTRAINT channel_post_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_posts channel_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_posts
    ADD CONSTRAINT channel_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: channel_posts channel_posts_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channel_posts
    ADD CONSTRAINT channel_posts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channels channels_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_poll_votes chat_poll_votes_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT chat_poll_votes_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_polls(message_id) ON DELETE CASCADE;


--
-- Name: chat_poll_votes chat_poll_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_poll_votes
    ADD CONSTRAINT chat_poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_polls chat_polls_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT chat_polls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: chat_polls chat_polls_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT chat_polls_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_polls chat_polls_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.chat_polls
    ADD CONSTRAINT chat_polls_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: clip_likes clip_likes_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.clip_likes
    ADD CONSTRAINT clip_likes_clip_id_fkey FOREIGN KEY (clip_id) REFERENCES public.clips(id) ON DELETE CASCADE;


--
-- Name: clip_likes clip_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.clip_likes
    ADD CONSTRAINT clip_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: clips clips_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: close_friends close_friends_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.close_friends
    ADD CONSTRAINT close_friends_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: close_friends close_friends_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.close_friends
    ADD CONSTRAINT close_friends_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: comments comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: conversation_invites conversation_invites_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_invites
    ADD CONSTRAINT conversation_invites_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_invites conversation_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_invites
    ADD CONSTRAINT conversation_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_invites conversation_invites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_invites
    ADD CONSTRAINT conversation_invites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_mutes conversation_mutes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_mutes
    ADD CONSTRAINT conversation_mutes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_mutes conversation_mutes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_mutes
    ADD CONSTRAINT conversation_mutes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_read_log conversation_read_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_read_log
    ADD CONSTRAINT conversation_read_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_read_log conversation_read_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_read_log
    ADD CONSTRAINT conversation_read_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_topic_mutes conversation_topic_mutes_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_mutes
    ADD CONSTRAINT conversation_topic_mutes_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.conversation_topics(id) ON DELETE CASCADE;


--
-- Name: conversation_topic_mutes conversation_topic_mutes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_mutes
    ADD CONSTRAINT conversation_topic_mutes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_topic_reads conversation_topic_reads_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_reads
    ADD CONSTRAINT conversation_topic_reads_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.conversation_topics(id) ON DELETE CASCADE;


--
-- Name: conversation_topic_reads conversation_topic_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topic_reads
    ADD CONSTRAINT conversation_topic_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_topics conversation_topics_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topics
    ADD CONSTRAINT conversation_topics_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_topics conversation_topics_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversation_topics
    ADD CONSTRAINT conversation_topics_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_pinned_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pinned_message_id_fkey FOREIGN KEY (pinned_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_secret_initiator_device_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_secret_initiator_device_fkey FOREIGN KEY (secret_initiator_device) REFERENCES public.e2e_devices(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_secret_initiator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_secret_initiator_fkey FOREIGN KEY (secret_initiator) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_secret_peer_device_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_secret_peer_device_fkey FOREIGN KEY (secret_peer_device) REFERENCES public.e2e_devices(id) ON DELETE SET NULL;


--
-- Name: dm_call_signals dm_call_signals_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_call_signals
    ADD CONSTRAINT dm_call_signals_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: dm_call_signals dm_call_signals_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_call_signals
    ADD CONSTRAINT dm_call_signals_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dm_call_signals dm_call_signals_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_call_signals
    ADD CONSTRAINT dm_call_signals_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dm_calls dm_calls_callee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_calls
    ADD CONSTRAINT dm_calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES public.users(id);


--
-- Name: dm_calls dm_calls_caller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_calls
    ADD CONSTRAINT dm_calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES public.users(id);


--
-- Name: dm_calls dm_calls_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.dm_calls
    ADD CONSTRAINT dm_calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: e2e_devices e2e_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.e2e_devices
    ADD CONSTRAINT e2e_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: e2e_prekeys e2e_prekeys_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.e2e_prekeys
    ADD CONSTRAINT e2e_prekeys_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.e2e_devices(id) ON DELETE CASCADE;


--
-- Name: email_verify_codes email_verify_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.email_verify_codes
    ADD CONSTRAINT email_verify_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follow_requests follow_requests_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follow_requests
    ADD CONSTRAINT follow_requests_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follow_requests follow_requests_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follow_requests
    ADD CONSTRAINT follow_requests_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_followee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: group_invite_links group_invite_links_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: group_invite_links group_invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: guest_links guest_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.guest_links
    ADD CONSTRAINT guest_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invite_codes invite_codes_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: live_streams live_streams_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.live_streams
    ADD CONSTRAINT live_streams_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: live_streams live_streams_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.live_streams
    ADD CONSTRAINT live_streams_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: live_streams live_streams_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.live_streams
    ADD CONSTRAINT live_streams_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: market_ads market_ads_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.market_ads
    ADD CONSTRAINT market_ads_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media_uploads media_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.media_uploads
    ADD CONSTRAINT media_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: media media_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: meetup_rsvps meetup_rsvps_meetup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetup_rsvps
    ADD CONSTRAINT meetup_rsvps_meetup_id_fkey FOREIGN KEY (meetup_id) REFERENCES public.meetups(id) ON DELETE CASCADE;


--
-- Name: meetup_rsvps meetup_rsvps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetup_rsvps
    ADD CONSTRAINT meetup_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: meetups meetups_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetups
    ADD CONSTRAINT meetups_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: meetups meetups_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.meetups
    ADD CONSTRAINT meetups_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_mentioned_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_mentioned_id_fkey FOREIGN KEY (mentioned_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: mentions mentions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mentions
    ADD CONSTRAINT mentions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: message_edits message_edits_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_edits
    ADD CONSTRAINT message_edits_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_hidden message_hidden_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_hidden
    ADD CONSTRAINT message_hidden_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_hidden message_hidden_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_hidden
    ADD CONSTRAINT message_hidden_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_transcripts message_transcripts_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_transcripts
    ADD CONSTRAINT message_transcripts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_transcripts message_transcripts_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_transcripts
    ADD CONSTRAINT message_transcripts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_translations message_translations_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.message_translations
    ADD CONSTRAINT message_translations_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_forward_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_forward_of_fkey FOREIGN KEY (forward_of) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: messages messages_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE SET NULL;


--
-- Name: messages messages_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.conversation_topics(id) ON DELETE SET NULL;


--
-- Name: mutes mutes_muted_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mutes
    ADD CONSTRAINT mutes_muted_id_fkey FOREIGN KEY (muted_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mutes mutes_muter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.mutes
    ADD CONSTRAINT mutes_muter_id_fkey FOREIGN KEY (muter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_prefs notification_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.notification_prefs
    ADD CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_codes password_reset_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.password_reset_codes
    ADD CONSTRAINT password_reset_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: poll_options poll_options_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_options
    ADD CONSTRAINT poll_options_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.polls(id) ON DELETE CASCADE;


--
-- Name: poll_votes poll_votes_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.poll_options(id) ON DELETE CASCADE;


--
-- Name: poll_votes poll_votes_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.polls(id) ON DELETE CASCADE;


--
-- Name: poll_votes poll_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: polls polls_channel_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_channel_post_id_fkey FOREIGN KEY (channel_post_id) REFERENCES public.channel_posts(id) ON DELETE CASCADE;


--
-- Name: polls polls_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.polls
    ADD CONSTRAINT polls_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_bookmarks post_bookmarks_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_bookmarks
    ADD CONSTRAINT post_bookmarks_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.bookmark_folders(id) ON DELETE SET NULL;


--
-- Name: post_bookmarks post_bookmarks_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_bookmarks
    ADD CONSTRAINT post_bookmarks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_bookmarks post_bookmarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_bookmarks
    ADD CONSTRAINT post_bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_images post_images_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_likes post_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_reposts post_reposts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_reposts
    ADD CONSTRAINT post_reposts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_reposts post_reposts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_reposts
    ADD CONSTRAINT post_reposts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_views post_views_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_views
    ADD CONSTRAINT post_views_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_views post_views_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.post_views
    ADD CONSTRAINT post_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: posts posts_repost_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_repost_of_fkey FOREIGN KEY (repost_of) REFERENCES public.posts(id) ON DELETE SET NULL;


--
-- Name: profile_widgets profile_widgets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.profile_widgets
    ADD CONSTRAINT profile_widgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: reports reports_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scheduled_dms scheduled_dms_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.scheduled_dms
    ADD CONSTRAINT scheduled_dms_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: scheduled_dms scheduled_dms_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.scheduled_dms
    ADD CONSTRAINT scheduled_dms_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: seller_reviews seller_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.seller_reviews
    ADD CONSTRAINT seller_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: seller_reviews seller_reviews_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.seller_reviews
    ADD CONSTRAINT seller_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stories stories_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: story_reactions story_reactions_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;


--
-- Name: story_reactions story_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: story_views story_views_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;


--
-- Name: story_views story_views_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.story_views
    ADD CONSTRAINT story_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_archive user_archive_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.user_archive
    ADD CONSTRAINT user_archive_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_chat_prefs user_chat_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.user_chat_prefs
    ADD CONSTRAINT user_chat_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_room_members voice_room_members_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_members
    ADD CONSTRAINT voice_room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE;


--
-- Name: voice_room_members voice_room_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_members
    ADD CONSTRAINT voice_room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_room_signals voice_room_signals_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_signals
    ADD CONSTRAINT voice_room_signals_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_room_signals voice_room_signals_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_signals
    ADD CONSTRAINT voice_room_signals_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE;


--
-- Name: voice_room_signals voice_room_signals_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_room_signals
    ADD CONSTRAINT voice_room_signals_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_rooms voice_rooms_host_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hub
--

ALTER TABLE ONLY public.voice_rooms
    ADD CONSTRAINT voice_rooms_host_id_fkey FOREIGN KEY (host_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict OqVnH2xTi568YScARABEicDCufThPAOgUDlLvqhpdlV7pXeLUmNIwpoPE1wkDaX

