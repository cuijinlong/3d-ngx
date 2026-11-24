
import { Button, Card, Empty, Statistic } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listScenes } from "../../services/scene/sceneService";
import { listAssets } from "../../services/asset/assetService";
import { listDevices } from "../../services/device/deviceService";
import { emptyScene, saveScene } from "../../services/scene/sceneService";
import { getPrefs } from "../../services/storage/db";
import type { SceneListItem } from "@idt/shared-types";
import { routes } from "../../constants/routes";

export function DashboardPage() {
  const nav = useNavigate();
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [deviceCount, setDeviceCount] = useState(0);
  const [lastScene, setLastScene] = useState<string>();
  const [lastRuntime, setLastRuntime] = useState<string>();

  useEffect(() => {
    void Promise.all([listScenes(), listAssets(), listDevices(), getPrefs()]).then(
      ([sceneRows, assets, devices, prefs]) => {
        setScenes(sceneRows);
        setAssetCount(assets.length);
        setDeviceCount(devices.length);
        setLastScene(prefs.lastSceneId);
        setLastRuntime(prefs.lastRuntimeId);
      },
    );
  }, []);

  const create = async () => {
    const doc = await saveScene(emptyScene("新建工业场景"));
    nav(routes.studioEditor(doc.scene.id));
  };

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">工业三维数字孪生</h1>
            <p className="page-sub">场景数据来自 guard-server 实时遥测，不再有演示数据开关</p>
          </div>
          <Button type="primary" onClick={() => void create()}>
            新建场景
          </Button>
        </div>
        <div className="card-grid" style={{ marginBottom: 20 }}>
          <Card><Statistic title="场景" value={scenes.length} /></Card>
          <Card><Statistic title="模型资产" value={assetCount} /></Card>
          <Card><Statistic title="模拟设备" value={deviceCount} /></Card>
        </div>
        <Card title="最近场景" extra={<Button type="link" onClick={() => nav(routes.studioScenes)}>全部场景</Button>}>
          {scenes.length === 0 ? (
            <Empty description="还没有场景，先新建一个并导入 GLB" />
          ) : (
            <div className="card-grid">
              {scenes.slice(0, 6).map((s) => (
                <Card
                  key={s.id}
                  hoverable
                  size="small"
                  title={s.name}
                  extra={s.publishedAt ? "已发布" : "草稿"}
                  onClick={() => nav(routes.studioEditor(s.id))}
                >
                  <div style={{ color: "var(--idt-muted)", fontSize: 12 }}>
                    {s.hasRootModel ? "已导入模型" : "未导入模型"} · 实体 {s.entityCount} · 更新 {s.updatedAt.slice(0, 16).replace("T", " ")}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {lastScene ? <Button onClick={() => nav(routes.studioEditor(lastScene))}>继续编辑</Button> : null}
          {lastRuntime ? <Button onClick={() => nav(routes.twinRuntime(lastRuntime))}>最近运行</Button> : null}
        </div>
      </div>
    </div>
  );
}
