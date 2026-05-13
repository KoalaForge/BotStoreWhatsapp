/**
 * Broadcast Status Controller (WhatsApp)
 * Handles GET /api/broadcast/:jobId
 *
 * Returns real-time progress of a broadcast job created via POST /api/broadcast/send.
 * Jobs are retained for 24 hours after completion.
 */

const waBroadcastQueueService = require('../../../services/waBroadcastQueueService');

function broadcastStatusController() {
    return async (request, reply) => {
        const { jobId } = request.params;

        const job = waBroadcastQueueService.getStatus(jobId);

        if (!job) {
            return reply.code(404).send({
                success: false,
                code:    404,
                message: 'Broadcast job not found or has expired (jobs are retained for 24 hours)'
            });
        }

        const processed = job.sent + job.failed;
        const progressPct = job.total > 0 ? Math.round((processed / job.total) * 100) : 100;

        return reply.code(200).send({
            success: true,
            code:    200,
            data: {
                job_id:       job.id,
                status:       job.status,
                total:        job.total,
                sent:         job.sent,
                failed:       job.failed,
                progress_pct: progressPct,
                created_at:   job.createdAt,
                completed_at: job.completedAt
            }
        });
    };
}

module.exports = { broadcastStatusController };
