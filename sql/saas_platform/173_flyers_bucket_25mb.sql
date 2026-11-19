-- 173 (Main 169). Flyer pictures are shrunk in the browser before
-- upload (js/components/flyerEditor.js prepareImage, about 6 MB max);
-- this raises the bucket ceiling from 10 MB to 25 MB as a safety margin
-- (AI cut-outs stay PNG) and accepts GIF too.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
where id = 'flyers';
