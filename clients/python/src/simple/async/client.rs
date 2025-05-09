use std::sync::Arc;

use actor_core_client::{self as actor_core_rs, CreateOptions, GetOptions, GetWithIdOptions};
use pyo3::prelude::*;

use crate::util::{try_opts_from_kwds, PyKwdArgs};

use super::handle::{ActorHandle, InnerActorData};

#[pyclass(name = "AsyncSimpleClient")]
pub struct Client {
    client: Arc<actor_core_rs::Client>,
}

#[pymethods]
impl Client {
    #[new]
    #[pyo3(signature=(
        endpoint,
        transport_kind="websocket",
        encoding_kind="json"
    ))]
    fn py_new(
        endpoint: &str,
        transport_kind: &str,
        encoding_kind: &str,
    ) -> PyResult<Self> {
        let transport_kind = try_transport_kind_from_str(&transport_kind)?;
        let encoding_kind = try_encoding_kind_from_str(&encoding_kind)?;
        let client = actor_core_rs::Client::new(
            endpoint.to_string(),
            transport_kind,
            encoding_kind
        );

        Ok(Client {
            client: Arc::new(client)
        })
    }

    #[pyo3(signature = (name, **kwds))]
    fn get<'a>(&self, py: Python<'a>, name: &str, kwds: Option<PyKwdArgs>) -> PyResult<Bound<'a, PyAny>> {
        let opts = try_opts_from_kwds::<GetOptions>(kwds)?;
        let name = name.to_string();
        let client = self.client.clone();
        
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let handle = client.get(&name, opts).await;

            match handle {
                Ok(handle) => Ok(ActorHandle {
                    handle,
                    data: InnerActorData::new(),
                }),
                Err(e) => Err(py_runtime_err!(
                    "Failed to get actor: {}",
                    e
                ))
            }
        })
    }

    #[pyo3(signature = (id, **kwds))]
    fn get_with_id<'a>(&self, py: Python<'a>, id: &str, kwds: Option<PyKwdArgs>) -> PyResult<Bound<'a, PyAny>> {
        let opts = try_opts_from_kwds::<GetWithIdOptions>(kwds)?;
        let id = id.to_string();
        let client = self.client.clone();
        
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let handle = client.get_with_id(&id, opts).await;

            match handle {
                Ok(handle) => Ok(ActorHandle {
                    handle,
                    data: InnerActorData::new(),
                }),
                Err(e) => Err(py_runtime_err!(
                    "Failed to get actor: {}",
                    e
                ))
            }
        })
    }

    #[pyo3(signature = (name, **kwds))]
    fn create<'a>(&self, py: Python<'a>, name: &str, kwds: Option<PyKwdArgs>) -> PyResult<Bound<'a, PyAny>> {
        let opts = try_opts_from_kwds::<CreateOptions>(kwds)?;
        let name = name.to_string();
        let client = self.client.clone();
        
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let handle = client.create(&name, opts).await;

            match handle {
                Ok(handle) => Ok(ActorHandle {
                    handle,
                    data: InnerActorData::new(),
                }),
                Err(e) => Err(py_runtime_err!(
                    "Failed to get actor: {}",
                    e
                ))
            }
        })
    }
}

fn try_transport_kind_from_str(
    transport_kind: &str
) -> PyResult<actor_core_rs::TransportKind> {
    match transport_kind {
        "websocket" => Ok(actor_core_rs::TransportKind::WebSocket),
        "sse" => Ok(actor_core_rs::TransportKind::Sse),
        _ => Err(py_value_err!(
            "Invalid transport kind: {}",
            transport_kind
        )),
    }
}

fn try_encoding_kind_from_str(
    encoding_kind: &str
) -> PyResult<actor_core_rs::EncodingKind> {
    match encoding_kind {
        "json" => Ok(actor_core_rs::EncodingKind::Json),
        "cbor" => Ok(actor_core_rs::EncodingKind::Cbor),
        _ => Err(py_value_err!(
            "Invalid encoding kind: {}",
            encoding_kind
        )),
    }
}