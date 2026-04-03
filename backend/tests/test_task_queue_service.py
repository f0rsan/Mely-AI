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


def test_task_queue_routes_background_and_gpu_tasks_to_separate_workers() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue()
        await queue.start()

        background_started = asyncio.Event()
        background_release = asyncio.Event()
        gpu_started = asyncio.Event()
        gpu_release = asyncio.Event()

        async def background_job(progress) -> None:
            background_started.set()
            await progress(20, "后台任务执行中")
            await background_release.wait()
            await progress(100, "后台任务完成")

        async def gpu_job(progress) -> None:
            gpu_started.set()
            await progress(20, "GPU 任务执行中")
            await gpu_release.wait()
            await progress(100, "GPU 任务完成")

        bg_task = await queue.submit(
            "download-long",
            background_job,
            category="background",
        )
        await asyncio.wait_for(background_started.wait(), timeout=1.0)

        gpu_task = await queue.submit(
            "training-short",
            gpu_job,
            category="gpu_exclusive",
        )
        await asyncio.wait_for(gpu_started.wait(), timeout=1.0)

        background_release.set()
        gpu_release.set()

        async def wait_completed(task_id: str) -> None:
            deadline = asyncio.get_event_loop().time() + 2.0
            while asyncio.get_event_loop().time() < deadline:
                snapshot = queue.get(task_id)
                if snapshot is not None and snapshot.status == "completed":
                    return
                await asyncio.sleep(0.02)
            raise AssertionError(f"任务未在超时前完成: {task_id}")

        await wait_completed(bg_task.id)
        await wait_completed(gpu_task.id)
        await queue.stop()

    asyncio.run(run_scenario())


def test_task_queue_keeps_gpu_tasks_mutually_exclusive() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue()
        await queue.start()

        first_gpu_started = asyncio.Event()
        first_gpu_release = asyncio.Event()
        second_gpu_started = asyncio.Event()

        async def first_gpu_job(progress) -> None:
            first_gpu_started.set()
            await progress(20, "第一个 GPU 任务执行中")
            await first_gpu_release.wait()
            await progress(100, "第一个 GPU 任务完成")

        async def second_gpu_job(progress) -> None:
            second_gpu_started.set()
            await progress(100, "第二个 GPU 任务完成")

        first_task = await queue.submit(
            "training-first",
            first_gpu_job,
            category="gpu_exclusive",
        )
        await asyncio.wait_for(first_gpu_started.wait(), timeout=1.0)

        second_task = await queue.submit(
            "generation-second",
            second_gpu_job,
            category="gpu_exclusive",
        )

        await asyncio.sleep(0.15)
        assert not second_gpu_started.is_set()

        first_gpu_release.set()
        await asyncio.wait_for(second_gpu_started.wait(), timeout=1.0)

        async def wait_completed(task_id: str) -> None:
            deadline = asyncio.get_event_loop().time() + 2.0
            while asyncio.get_event_loop().time() < deadline:
                snapshot = queue.get(task_id)
                if snapshot is not None and snapshot.status == "completed":
                    return
                await asyncio.sleep(0.02)
            raise AssertionError(f"任务未在超时前完成: {task_id}")

        await wait_completed(first_task.id)
        await wait_completed(second_task.id)
        await queue.stop()

    asyncio.run(run_scenario())


def test_task_queue_stop_does_not_block_on_long_background_task() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue(stop_timeout_seconds=0.1)
        await queue.start()

        async def long_background_job(progress) -> None:
            await progress(10, "后台任务执行中")
            await asyncio.sleep(10)

        await queue.submit(
            "download-very-long",
            long_background_job,
            category="background",
        )

        await asyncio.sleep(0.05)
        start = asyncio.get_event_loop().time()
        await queue.stop()
        elapsed = asyncio.get_event_loop().time() - start
        assert elapsed < 1.0

    asyncio.run(run_scenario())


def test_task_queue_preserves_last_message_on_completed() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue()
        await queue.start()

        async def job(progress) -> None:
            await progress(60, "阶段中")
            await progress(100, '{"archiveId":"g-1"}')

        created = await queue.submit("demo-archive-message", job, category="background")

        deadline = asyncio.get_event_loop().time() + 2.0
        while asyncio.get_event_loop().time() < deadline:
            snapshot = queue.get(created.id)
            if snapshot is not None and snapshot.status == "completed":
                assert snapshot.message == '{"archiveId":"g-1"}'
                break
            await asyncio.sleep(0.02)
        else:
            raise AssertionError("任务未在超时前完成")

        await queue.stop()

    asyncio.run(run_scenario())


def test_task_queue_can_restart_after_timeout_stop() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue(stop_timeout_seconds=0.1)
        await queue.start()

        long_started = asyncio.Event()

        async def long_job(progress) -> None:
            long_started.set()
            await progress(10, "后台任务执行中")
            await asyncio.sleep(10)

        await queue.submit(
            "download-very-long",
            long_job,
            category="background",
        )
        await asyncio.wait_for(long_started.wait(), timeout=1.0)
        await queue.stop()

        await queue.start()
        short_done = asyncio.Event()

        async def short_job(progress) -> None:
            await progress(100, "短任务完成")
            short_done.set()

        short_task = await queue.submit(
            "download-short",
            short_job,
            category="background",
        )
        await asyncio.wait_for(short_done.wait(), timeout=1.0)
        assert queue.get(short_task.id).status == "completed"

        await queue.stop()

    asyncio.run(run_scenario())


def test_task_queue_timeout_stop_marks_running_task_failed() -> None:
    async def run_scenario() -> None:
        queue = TaskQueue(stop_timeout_seconds=0.1)
        await queue.start()

        started = asyncio.Event()

        async def long_job(progress) -> None:
            started.set()
            await progress(10, "后台任务执行中")
            await asyncio.sleep(10)

        task = await queue.submit(
            "download-cancel-me",
            long_job,
            category="background",
        )
        await asyncio.wait_for(started.wait(), timeout=1.0)
        await queue.stop()

        snapshot = queue.get(task.id)
        assert snapshot is not None
        assert snapshot.status == "failed"
        assert snapshot.error == "任务已中断，请重试。"

    asyncio.run(run_scenario())
