use pyo3::prelude::*;

#[macro_use]
mod util;
mod simple;
mod events;

#[pymodule]
fn python_actor_core_client(m: &Bound<'_, PyModule>) -> PyResult<()> {
    simple::init_module(m)?;
    events::init_module(m)?;


    Ok(())
}
