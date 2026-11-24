
import { Button, Card, Empty } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SceneListItem } from "@idt/shared-types";
import { routes } from "../../constants/routes";
import { listScenes } from "../../services/scene/sceneService";

export function TwinScenesPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<SceneListItem[]>([]);
  useEffect(() => { void listScenes().then(setRows); }, []);
  const published = rows.filter((s) => s.publishedAt);
  const list = published.length ? published : rows;

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">运行场景</h1>
            <p className="page-sub">打开已发布的场景进入 Runtime，数据来自 guard-server 实时遥测。</p>
          </div>
        </div>
        {list.length === 0 ? <Empty description="请先在工作室保存并发布一个场景" /> : (
          <div className="card-grid">
            {list.map((s) => (
              <Card key={s.id} title={s.name} extra={s.publishedAt ? "已发布" : "草稿可预览"}>
                <Button type="primary" onClick={() => nav(routes.twinRuntime(s.id))}>进入运行</Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
