// hoc/withAuthProtection.js
import { useEffect } from "react";
import { useRouter } from "next/router";

const withAuthProtection = (WrappedComponent) => {
    return function ProtectedComponent(props) {
        const router = useRouter();

        useEffect(() => {
            const user = localStorage.getItem("user");
            if (!user) {
                router.replace("/login");
            }
        }, []);

        return <WrappedComponent {...props} />;
    };
};

export default withAuthProtection;
