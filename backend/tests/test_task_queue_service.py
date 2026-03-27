import asyncio

from app.services.task_queue import TaskQueue


def test_task_queue_broadcasts_running_and_completed_events() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue()
        await queue.start()
        subscriber = queue.subscribe()

        async def simulated_job(progress) -> None:
            await progress(30, "阶段一")
            await progress(100, "阶段完成")

        created = await queue.submit("demo-success", simulated_job)
        task_id = created.id

        events: list[dict] = []
        for _ in range(8):
            event = await asyncio.wait_for(subscriber.get(), timeout=1.0)
            if event["task"]["id"] == task_id:
                events.append(event)
            if events and events[-1]["task"]["status"] == "completed":
                break

        await queue.unsubscribe(subscriber)
        await queue.stop()

        statuses = [item["task"]["status"] for item in events]
        assert statuses[0] == "pending"
        assert "running" in statuses
        assert statuses[-1] == "completed"
        assert events[-1]["task"]["progress"] == 100

    asyncio.run(run_scenario())


def test_task_queue_broadcasts_failed_event() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue()
        await queue.start()
        subscriber = queue.subscribe()

        async def failing_job(progress) -> None:
            await progress(40, "执行中")
            raise RuntimeError("测试失败")

        created = await queue.submit("demo-failed", failing_job)
        task_id = created.id

        failed_event: dict | None = None
        for _ in range(6):
            event = await asyncio.wait_for(subscriber.get(), timeout=1.0)
            if event["task"]["id"] != task_id:
                continue
            if event["task"]["status"] == "failed":
                failed_event = event
                break

        await queue.unsubscribe(subscriber)
        await queue.stop()

        assert failed_event is not None
        assert failed_event["task"]["progress"] == 40
        assert failed_event["task"]["error"] == "测试失败"

    asyncio.run(run_scenario())
