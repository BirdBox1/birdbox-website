-- Members' discussion under BirdBox blog posts (Nathan, 1 Nov 2026).
-- The blog stays public; comments are only for BirdBox members logged in to
-- BirdBox Learn, who can read, comment and reply. Nobody else (and no
-- search engine) can read them.
--
-- The blog-comments function sets the name shown and whether it is BirdBox
-- staff or the post's author, checks for spam and emails the author.

create table public.blog_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.blog_posts(id) on delete cascade,
  parent_id   uuid references public.blog_comments(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  role        text not null default 'member' check (role in ('member', 'staff', 'author')),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz,
  hidden_by   uuid references auth.users(id),
  reports     int not null default 0
);

create index blog_comments_post_idx on public.blog_comments (post_id, created_at);

-- One report per person per comment; three reports hide a comment until
-- staff look at it.
create table public.blog_comment_reports (
  comment_id  uuid not null references public.blog_comments(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Only BirdBox members take part: staff, and anyone who has bought from
-- BirdBox (a seminar, online course, programming, block, T-shirt or gift
-- card) or been given programming. A BirdBox Learn login on its own is not
-- enough, because anyone can ask for one. So comments are read and written
-- only through the blog-comments function, which checks that first; no
-- login reads this table directly.
alter table public.blog_comments enable row level security;
alter table public.blog_comment_reports enable row level security;
revoke all on public.blog_comments, public.blog_comment_reports from anon, authenticated;
