-- Blog author photos (Nathan, 10 Nov 2026). Applied 10 Nov 2026.
-- 34 posts had author_photo_path = the author's staff profile photo
-- ("<staff id>.jpg"), which is in the PRIVATE staff-photos bucket; the blog
-- reads the public "blog" bucket, so those photos never loaded. They now
-- point at the author's Meet the Team photo (a full https link, which the
-- blog pages use as it is). Michaela's 17 Aug post, which had none, too.
with src as (
  select b.id,
         coalesce(cp.photo_path, case when s.full_name = 'Sarah Haspel'
           then 'https://birdboxcoaching.com/birdbox-team/sarah-haspel.jpeg' end) new
  from public.blog_posts b
  join public.staff s on s.photo_path = b.author_photo_path
  left join train.coach_profiles cp on cp.staff_id = s.id
    and cp.photo_path like 'https://birdboxcoaching.com/birdbox-team/%'
  where not exists (select 1 from storage.objects o
                    where o.bucket_id = 'blog' and o.name = b.author_photo_path)
)
update public.blog_posts b set author_photo_path = src.new
from src where b.id = src.id and src.new is not null;

update public.blog_posts
   set author_photo_path = 'https://birdboxcoaching.com/birdbox-team/michaela-dotterweich.jpeg'
 where author_name = 'Michaela Dotterweich' and author_photo_path is null and status = 'published';

-- UNDO (back to the staff photo key, which did not show):
-- update public.blog_posts b set author_photo_path = b.author_staff_id::text || '.jpg'
--  where author_photo_path like 'https://birdboxcoaching.com/birdbox-team/%';
