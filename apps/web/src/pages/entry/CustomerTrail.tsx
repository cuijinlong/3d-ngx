import { Link } from "react-router-dom";
import { routes } from "../../constants/routes";
import { entryStyles as styles } from "./EntryChrome";

/** 有客户名就写出来；没有名字时用可点的「选择客户」，不要只写无名「客户」。 */
export function CustomerTrail(props: {
  customerName?: string;
  current: string;
  nameTo?: string;
}) {
  const name = props.customerName?.trim();
  const nameTo = props.nameTo ?? routes.selectCustomer;
  return (
    <>
      {name ? (
        <Link to={nameTo} className={styles.link} style={{ marginRight: 0 }}>
          {name}
        </Link>
      ) : (
        <Link to={routes.selectCustomer} className={styles.link} style={{ marginRight: 0 }}>
          选择客户
        </Link>
      )}
      <span className={styles.sep}>/</span>
      <b>{props.current}</b>
    </>
  );
}
