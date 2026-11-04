-- A photo the developer showed again before a review marked its reports handled still has three or
-- more reports that aren't, so the next single report would hide it again. Such a photo counts as
-- kept: its reports are marked handled, and three new ones hide it as they do any kept photo. A
-- photo still hidden keeps its reports as they are, for the developer's review.
update public.reports r
set handled_at = now()
where r.handled_at is null
  and r.feed_id in (
    select x.feed_id
    from public.reports x
    join public.feeds f on f.id = x.feed_id
    where x.handled_at is null and f.hidden_at is null
    group by x.feed_id
    having count(*) >= 3
  );
