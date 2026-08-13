-- Duplicate-document protection: a PDF is deduplicated within a single exam by
-- its SHA-256 content hash. The same file may still be uploaded for a
-- different exam (examId + fileHash scope).
CREATE UNIQUE INDEX "uploaded_exam_documents_exam_id_file_hash_key"
    ON "uploaded_exam_documents"("exam_id", "file_hash");